/**
 * Channel-files tools — list and read files attached to channel messages.
 *
 * Raltic users drop files into channels via the existing R2 uploads
 * pipeline (apps/api/src/routes/uploads.ts); this tool lets the agent
 * discover and read those files without needing the sandbox container.
 *
 * Security model (post codex review):
 *   - list/read are filtered to channels the agent is a member of.
 *   - read_uploaded_file takes (channelId, messageId, url) NOT just url.
 *     The url MUST appear in the named message body AND that message
 *     must be in a channel the agent is a member of. This prevents
 *     SSRF-style URL hijacking where the agent supplies an attacker's
 *     URL with `/uploads/` in the path.
 *   - The host of the URL must be on the trusted Raltic uploads origin
 *     list (env-driven, defaults to raltic.com + api.raltic.com).
 */
import { tool } from "ai";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, desc } from "drizzle-orm";
import { messages, channelMembers } from "@raltic/db";
import type { ToolDispatchCtx, ToolRegistry } from "./registry.js";

const READ_MAX_BYTES = 2 * 1024 * 1024;   // 2 MiB
const READ_TIMEOUT_MS = 20_000;

/**
 * Trusted upload origins. Anything else is refused by read_uploaded_file
 * even if it appears in a message body — the path namespace alone is
 * not enough proof (the agent or a malicious sender could post
 * `https://attacker/uploads/x`).
 */
const TRUSTED_UPLOAD_HOSTS = new Set([
  "raltic.com",
  "api.raltic.com",
  "raltic-uploads.r2.cloudflarestorage.com",
]);

/**
 * Best-effort attachment extraction from message content. Raltic stores
 * uploaded-file URLs inline in markdown content `![alt](url)` or
 * `[name](url)`. Exported for unit testing — codex caught the test
 * reimplementing this and missing real regression coverage.
 */
export function extractAttachmentUrls(content: string): string[] {
  if (!content) return [];
  const out: string[] = [];
  // Markdown image / link with raltic uploads URL.
  const re = /!?\[[^\]]*\]\((https?:\/\/[^)\s]+\/uploads\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  // Bare URLs ending in common file extensions (Slack-style auto-upload
  // links). Require word-boundary-style leading delimiter so we don't
  // pick up `nothttps://...` constructed adversarially.
  const bareRe = /(?:^|[\s(>])(https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp|pdf|md|txt|csv|json|tsv|log))(?=\s|$|[.,;:!?])/gi;
  while ((m = bareRe.exec(content)) !== null) {
    if (m[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function isTrustedUploadUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  // Port must be the default for https (empty string OR explicit 443).
  // Codex MED: prior version allowed arbitrary port on a trusted host,
  // letting `https://raltic.com:8080/uploads/x` pass — that could route
  // through an attacker-controlled port-forwarder.
  if (u.port !== "" && u.port !== "443") return false;
  if (!TRUSTED_UPLOAD_HOSTS.has(u.hostname.toLowerCase())) return false;
  if (!u.pathname.startsWith("/uploads/")) return false;
  return true;
}

export function channelFilesTools(ctx: ToolDispatchCtx): ToolRegistry {
  return {
    list_channel_files: tool({
      description:
        "List file attachments visible in a channel the agent is a member of. Returns recent uploads (max 50). Use before read_uploaded_file to discover what's available; each row gives you the (channelId, messageId, url) triple the read tool requires.",
      inputSchema: z.object({
        channelId: z.string().min(1),
        limit: z.number().int().positive().max(50).default(20),
      }),
      execute: async ({ channelId, limit }) => {
        // ACL: agent must be a channel member.
        const db = drizzle(ctx.env.DB);
        const member = await db.select({ id: channelMembers.memberId })
          .from(channelMembers)
          .where(and(
            eq(channelMembers.channelId, channelId),
            eq(channelMembers.memberId, ctx.state.agentId),
            eq(channelMembers.memberType, "agent"),
          )).limit(1);
        if (member.length === 0) {
          throw new Error("agent is not a member of this channel");
        }
        // Scan recent N messages for attachment URLs.
        const rows = await db.select({
          id: messages.id,
          senderId: messages.senderId,
          content: messages.content,
          createdAt: messages.createdAt,
        }).from(messages)
          .where(eq(messages.channelId, channelId))
          .orderBy(desc(messages.createdAt))
          .limit(limit);
        const files: Array<{ url: string; channelId: string; messageId: string; senderId: string; postedAt: number }> = [];
        for (const r of rows) {
          // Drizzle returns timestamp_ms columns as Date; normalize to ms epoch
          // for the JSON-facing tool response so the agent always sees a number.
          const postedAt = r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt);
          for (const url of extractAttachmentUrls(r.content)) {
            files.push({ url, channelId, messageId: r.id, senderId: r.senderId, postedAt });
          }
        }
        return { files: files.slice(0, limit) };
      },
    }),

    read_uploaded_file: tool({
      description:
        "Fetch a file uploaded to a Raltic channel. Requires the (channelId, messageId, url) triple from list_channel_files — the tool re-verifies the URL appears in that message AND the agent is a channel member AND the URL host is a trusted Raltic origin. Returns text for text files; base64 for binaries. Capped at 2 MiB.",
      inputSchema: z.object({
        channelId: z.string().min(1).describe("Channel that contains the message hosting this URL."),
        messageId: z.string().min(1).describe("Specific message whose body must contain this URL."),
        url: z.string().url(),
        encoding: z.enum(["text", "base64"]).optional(),
      }),
      execute: async ({ channelId, messageId, url, encoding }) => {
        // Step 1: agent ACL — agent must be a member of the channel.
        const db = drizzle(ctx.env.DB);
        const member = await db.select({ id: channelMembers.memberId })
          .from(channelMembers)
          .where(and(
            eq(channelMembers.channelId, channelId),
            eq(channelMembers.memberId, ctx.state.agentId),
            eq(channelMembers.memberType, "agent"),
          )).limit(1);
        if (member.length === 0) {
          return { ok: false, error: "agent is not a member of this channel" };
        }
        // Step 2: message must be in that channel AND its body must
        // actually contain the URL (so an agent can't supply an attacker
        // URL that happens to match the trusted-host pattern).
        // TOCTOU note (codex LOW): an edit/delete between this check and
        // the fetch below could make our authorization stale. Accepted
        // for v1 — the edit window is tiny, the host is still trusted,
        // and the worst case is reading a URL the original message
        // author posted. P3 will move to immutable attachment records
        // keyed by id to remove the gap entirely.
        const msg = await db.select({
          id: messages.id, channelId: messages.channelId, content: messages.content,
        }).from(messages)
          .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)))
          .limit(1);
        if (msg.length === 0) {
          return { ok: false, error: "no such message in this channel" };
        }
        const urlsInMessage = extractAttachmentUrls(msg[0]!.content ?? "");
        if (!urlsInMessage.includes(url)) {
          return { ok: false, error: "url is not attached to this message" };
        }
        // Step 3: host allowlist — even if all the above passes, refuse
        // to fetch anything that isn't on a trusted Raltic origin.
        if (!isTrustedUploadUrl(url)) {
          return { ok: false, error: "url host is not a trusted Raltic upload origin" };
        }

        // Stream-cap fetch.
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), READ_TIMEOUT_MS);
        try {
          const res = await fetch(url, { signal: ac.signal, redirect: "manual" });
          // Reject any redirect — a 30x on trusted host could still
          // smuggle the agent to a different origin.
          if (res.status >= 300 && res.status < 400) {
            return { ok: false, error: "trusted upload host returned a redirect; refusing to follow" };
          }
          if (!res.ok) return { ok: false, status: res.status, error: res.statusText };
          const reader = res.body?.getReader();
          if (!reader) return { ok: true, status: res.status, content: "", encoding: "text" as const, bytes: 0 };
          const chunks: Uint8Array[] = [];
          let total = 0;
          let truncated = false;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (total + value.byteLength > READ_MAX_BYTES) {
              const room = READ_MAX_BYTES - total;
              if (room > 0) chunks.push(value.subarray(0, room));
              total = READ_MAX_BYTES;
              truncated = true;
              try { await reader.cancel(); } catch { /* swallow */ }
              break;
            }
            chunks.push(value);
            total += value.byteLength;
          }
          const buf = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
          const wantBase64 = encoding === "base64";
          const content = wantBase64
            // Manual base64 — Workers' atob/btoa work on binary strings.
            ? btoa(Array.from(buf).map(b => String.fromCharCode(b)).join(""))
            : new TextDecoder("utf-8").decode(buf);
          return {
            ok: true,
            status: res.status,
            contentType: res.headers.get("content-type"),
            content,
            encoding: wantBase64 ? "base64" as const : "text" as const,
            bytes: total,
            truncated,
          };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        } finally {
          clearTimeout(timer);
        }
      },
    }),
  };
}

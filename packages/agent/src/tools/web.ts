/**
 * Web tools — fetch a URL or run a web search.
 *
 * Both are in-Worker (no container needed) so they're cheap to invoke
 * and don't trigger lazy sandbox provisioning. Useful for agents that
 * need to summarise an external article or look up current information.
 *
 * Safety:
 *   - URLs validated by zod .url() then re-checked against allowlist
 *     of public schemes (https only — http blocked, file:/javascript:
 *     never allowed by .url() anyway).
 *   - Response size capped (1 MiB) — a 100 MB PDF doesn't OOM the DO.
 *   - Response time capped (30s) — slow sites don't stall the agent.
 *   - Body returned as plain text after a naive HTML→text strip; agent
 *     loop can ask for full HTML via `format:'html'` if it needs it.
 */
import { tool } from "ai";
import { z } from "zod";
import type { ToolDispatchCtx, ToolRegistry } from "./registry.js";

const FETCH_MAX_BYTES = 1 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const REDIRECT_MAX = 5;

/**
 * SSRF defence: block private / loopback / link-local / multicast /
 * cloud-metadata IP ranges so the agent can't pivot from public DNS to
 * an internal host via DNS rebinding, open redirect, or simply typing
 * `https://10.0.0.1`. The hostname is resolved by the Worker fetch
 * runtime; we re-check after each follow.
 *
 * NOTE: Workers' fetch doesn't expose direct IP resolution. We block
 * any URL whose hostname literally parses as a private / link-local IP
 * AND any hostname known to alias to one (metadata.google.internal,
 * etc.). For DNS rebinding we additionally `redirect: "manual"` so a
 * 30x Location can't smuggle the agent to a private host.
 */
const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata",
  "metadata.aws.amazon.com",
  "169.254.169.254",
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
]);

/**
 * Decimal / hex IPv4 form check — `https://2130706433/` is 127.0.0.1,
 * `https://0x7f000001/` likewise. Block the whole shorthand family by
 * detecting non-dotted-quad numeric hostnames and refusing.
 */
function isNumericIpShorthand(h: string): boolean {
  if (/^(0x[0-9a-f]+|\d+)$/i.test(h)) return true;
  // Octal-prefixed octets (010.0.0.1 = 8.0.0.1) — refuse anything with
  // a leading-zero octet of 2+ digits, which Node's URL parser
  // (intentionally) doesn't normalise.
  if (/^0\d+\./.test(h)) return true;
  return false;
}

/**
 * Expand a compressed IPv6 `::` into full 8-group form, lowercase hex,
 * 4-char zero-padded groups. e.g. `[::1]` → `0000:...:0001`. Returns
 * null if the literal is malformed (we refuse those at the call site).
 */
function expandIpv6(literal: string): string | null {
  if (!/^[0-9a-fA-F:.]+$/.test(literal)) return null;
  let main = literal;
  // IPv4-mapped form `::ffff:127.0.0.1` — keep the dotted suffix for
  // later check; we treat any embedded IPv4 as a separate check.
  if (literal.includes("::")) {
    const [head, tail] = literal.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 0) return null;
    main = [
      ...headParts,
      ...Array.from({ length: missing }, () => "0"),
      ...tailParts,
    ].join(":");
  }
  const parts = main.split(":");
  if (parts.length !== 8) return null;
  return parts.map(p => p.toLowerCase().padStart(4, "0")).join(":");
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  // Decimal / hex / shorthand IPv4 forms (e.g. https://2130706433 = 127.0.0.1)
  if (isNumericIpShorthand(h)) return true;
  // Literal IPv4 private / loopback / link-local ranges.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const o = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
    if (o.some(n => n < 0 || n > 255)) return true;          // malformed → block
    if (o[0] === 10) return true;                            // 10.0.0.0/8
    if (o[0] === 127) return true;                           // 127.0.0.0/8 loopback
    if (o[0] === 169 && o[1] === 254) return true;           // link-local
    if (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) return true;  // 172.16.0.0/12
    if (o[0] === 192 && o[1] === 168) return true;           // 192.168.0.0/16
    if (o[0] === 0) return true;                             // 0.0.0.0/8
    if (o[0]! >= 224) return true;                           // multicast / reserved
  }
  // IPv6 literal: `[::1]`, `[fe80::...]`, `[0:0:0:0:0:0:0:1]`,
  // `[::ffff:127.0.0.1]`, etc. Expand to full form before checking
  // (codex caught the prior prefix-only check missing zero-pad and
  // IPv4-mapped variants).
  if (h.startsWith("[") && h.endsWith("]")) {
    const inner = h.slice(1, -1);
    // IPv4-mapped: ::ffff:a.b.c.d — block if the embedded IPv4 is private.
    const mapped = /::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(inner);
    if (mapped && mapped[1] && isBlockedHost(mapped[1])) return true;
    const expanded = expandIpv6(inner);
    if (!expanded) return true;   // malformed → block conservatively
    // Loopback `0000:...:0001` (::1) and unspecified `0000:...:0000` (::)
    if (expanded === "0000:0000:0000:0000:0000:0000:0000:0001") return true;
    if (expanded === "0000:0000:0000:0000:0000:0000:0000:0000") return true;
    // Link-local fe80::/10
    if (expanded.startsWith("fe8") || expanded.startsWith("fe9") ||
        expanded.startsWith("fea") || expanded.startsWith("feb")) return true;
    // Unique-local fc00::/7 (fc00..fdff)
    if (expanded.startsWith("fc") || expanded.startsWith("fd")) return true;
    // Multicast ff00::/8
    if (expanded.startsWith("ff")) return true;
  }
  return false;
}

function isSafeHttpsUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(raw); }
  catch { return { ok: false, reason: "invalid url" }; }
  if (u.protocol !== "https:") return { ok: false, reason: "only https" };
  if (u.username || u.password) return { ok: false, reason: "userinfo in url is not allowed" };
  if (isBlockedHost(u.hostname)) return { ok: false, reason: `blocked host: ${u.hostname}` };
  // KNOWN LIMITATION: Workers' fetch resolves DNS at the CF edge and
  // does NOT expose the resolved IP to us. A DNS name that resolves to a
  // private IP (e.g. an attacker-controlled record pointing at 10.0.0.1)
  // would bypass the literal-IP block. Mitigation requires a Cloudflare
  // Egress Worker / Bound IPs deployment we don't yet have; documented
  // here so the next iteration of P3 wires that up.
  return { ok: true, url: u };
}

export function webTools(_ctx: ToolDispatchCtx): ToolRegistry {
  return {
    web_fetch: tool({
      description:
        "Fetch a public HTTPS URL and return the body. Use to read articles, docs, API JSON, etc. Returns plain text (HTML stripped) by default; pass format:'html' for raw HTML or 'json' to parse JSON. Capped at 1 MiB and 30s.",
      inputSchema: z.object({
        url: z.string().url().refine((u) => u.startsWith("https://"), {
          message: "only https:// URLs allowed",
        }),
        format: z.enum(["text", "html", "json"]).optional(),
        method: z.enum(["GET", "POST"]).optional(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().max(64 * 1024).optional(),
      }),
      execute: async ({ url, format, method, headers, body }) => {
        // SSRF defence: validate the initial URL + manually follow
        // redirects, re-checking each Location. fetch's "follow" mode
        // doesn't expose intermediate URLs so a 30x → private-IP smuggle
        // would slip past with the default. (codex security HIGH)
        const initial = isSafeHttpsUrl(url);
        if (!initial.ok) return { ok: false, error: `refused: ${initial.reason}` };

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
        let currentUrl = initial.url.toString();
        let res: Response;
        try {
          let hops = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            res = await fetch(currentUrl, {
              method: method ?? "GET",
              headers: (headers ?? {}) as Record<string, string>,
              body: body,
              signal: ac.signal,
              redirect: "manual",
            });
            // 3xx → re-validate Location, then follow.
            const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
            if (!loc) break;
            if (++hops > REDIRECT_MAX) {
              return { ok: false, error: `too many redirects (>${REDIRECT_MAX})` };
            }
            // Resolve relative redirects against the current URL.
            const nextRaw = new URL(loc, currentUrl).toString();
            const nextCheck = isSafeHttpsUrl(nextRaw);
            if (!nextCheck.ok) {
              return { ok: false, error: `redirect to blocked host: ${nextCheck.reason}` };
            }
            currentUrl = nextCheck.url.toString();
          }
          // Read up to FETCH_MAX_BYTES; truncate beyond.
          const reader = res.body?.getReader();
          if (!reader) {
            return { ok: res.ok, status: res.status, body: "", truncated: false };
          }
          const chunks: Uint8Array[] = [];
          let total = 0;
          let truncated = false;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (total + value.byteLength > FETCH_MAX_BYTES) {
              const room = FETCH_MAX_BYTES - total;
              if (room > 0) chunks.push(value.subarray(0, room));
              total = FETCH_MAX_BYTES;
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
          const raw = new TextDecoder("utf-8").decode(buf);
          let payload: unknown;
          const fmt = format ?? "text";
          if (fmt === "json") {
            try { payload = JSON.parse(raw); }
            catch (e) { return { ok: false, status: res.status, error: `JSON parse: ${String(e)}`, truncated }; }
          } else if (fmt === "html") {
            payload = raw;
          } else {
            // Naive HTML → text: strip tags, collapse whitespace.
            payload = raw
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 100_000);
          }
          return {
            ok: res.ok,
            status: res.status,
            url: res.url,
            contentType: res.headers.get("content-type"),
            body: payload,
            truncated,
          };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        } finally {
          clearTimeout(timer);
        }
      },
    }),

    web_search: tool({
      description:
        "Search the web. Returns the top results (title, URL, snippet). Use when the user asks about recent news, current facts, or anything not in your training data. Wraps Brave Search API; respects per-agent rate limit (60/hr/agent).",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().positive().max(20).default(8),
      }),
      execute: async ({ query, limit }) => {
        // Brave Search requires an API key. If not configured, return an
        // explicit "not configured" message instead of throwing so the
        // agent loop can choose to web_fetch a known URL instead.
        const key = (_ctx.env as { BRAVE_SEARCH_API_KEY?: string }).BRAVE_SEARCH_API_KEY;
        if (!key) {
          return { ok: false, error: "web_search not configured (BRAVE_SEARCH_API_KEY secret unset)" };
        }
        try {
          const url = new URL("https://api.search.brave.com/res/v1/web/search");
          url.searchParams.set("q", query);
          url.searchParams.set("count", String(limit));
          const res = await fetch(url, {
            headers: {
              accept: "application/json",
              "x-subscription-token": key,
            },
          });
          if (!res.ok) {
            return { ok: false, status: res.status, error: await res.text().catch(() => "") };
          }
          const data = await res.json() as {
            web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
          };
          const results = (data.web?.results ?? []).slice(0, limit).map(r => ({
            title: r.title ?? "",
            url: r.url ?? "",
            snippet: r.description ?? "",
          }));
          return { ok: true, results };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
  };
}

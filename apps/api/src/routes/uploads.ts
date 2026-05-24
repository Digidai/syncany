import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { uploadAvatarRequest } from "@raltic/protocol";
import { channels, messageAttachments, user } from "@raltic/db";
import { and, eq, gt, isNull, sql as sqlFn } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requirePolicy, policy } from "@raltic/auth-core";
import { requireAuth, requireUser, ctxFor } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";

// Phase C — message attachments. Worker-proxied upload (no R2 signed
// URL signing dep in v1). Allowlisted MIME types, hard 25 MB per file,
// 100 MB rolling 24h quota per user.
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ATTACHMENT_QUOTA_BYTES = 100 * 1024 * 1024; // 100 MB / 24h / user
const ATTACHMENT_MIME_ALLOW = /^(image\/(png|jpe?g|gif|webp)|application\/(pdf|zip)|text\/(plain|markdown))$/;

export const uploadsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/uploads/avatar — issue a one-shot R2 PUT URL for the user's avatar
// ---------------------------------------------------------------------------
// requireUser on the POST AND the PUT: an avatar upload mutates
// `user.image`, which is identity-level state. A machine key bearer
// (bridge) hitting either endpoint could set the user's avatar to an
// attacker-controlled URL — possible griefing surface for a compromised
// bridge process. Cookie/api_token only.
uploadsRoutes.post("/api/v1/uploads/avatar", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  // 30 upload tokens/hr/user. Avatar UI re-issues on every preview;
  // server-icon upload is rare. Cap to stop a malicious account from
  // grinding fresh R2 keys.
  const limited = await rateLimit(c, "upload_avatar", subject.userId, 30, 3600);
  if (limited) return limited;
  const body = uploadAvatarRequest.parse(await c.req.json());
  // Namespace prefix per purpose so the PUT handler can decide whether to
  // touch user.image. server-icons live in a sibling prefix; the GET
  // /uploads/:key endpoint serves both (both are public-by-design).
  const ns = body.purpose === "server_icon" ? "server-icons" : "avatars";
  const key = `${ns}/${subject.userId}/${crypto.randomUUID()}`;
  // R2 doesn't ship with presigned PUT in Workers runtime; we proxy uploads
  // through the api Worker instead. Return the upload endpoint URL — the
  // client POSTs the file there with the Bearer token still attached.
  return c.json({
    uploadUrl: `${new URL(c.req.url).origin}/api/v1/uploads/r2/${encodeURIComponent(key)}`,
    publicUrl: `${new URL(c.req.url).origin}/uploads/${key}`,
    key,
  });
});

uploadsRoutes.put("/api/v1/uploads/r2/:key{.+}", requireAuth, requireUser, async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  const subject = c.get("subject");
  // 60 PUTs/min/user — the matching POST is rate-limited to 30/hr but
  // the PUT itself wasn't capped at all (codex review caught this);
  // a held-open key could be re-PUT thousands of times even after the
  // POST window closed.
  const putLimit = await rateLimit(c, "upload_r2_put", subject.userId, 60, 60);
  if (putLimit) return putLimit;
  // Accept either prefix; both are scoped to the uploader's userId so a
  // signed-in user can never write into another user's namespace.
  const isAvatar = key.startsWith(`avatars/${subject.userId}/`);
  const isServerIcon = key.startsWith(`server-icons/${subject.userId}/`);
  if (!isAvatar && !isServerIcon) {
    return c.json({ error: { code: "FORBIDDEN", message: "key namespace mismatch" } }, 403);
  }
  const ct = c.req.header("content-type") ?? "application/octet-stream";
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(ct)) {
    return c.json({ error: { code: "BAD_TYPE", message: "image/* only" } }, 400);
  }
  // Pre-flight content-length check — refuse oversized uploads BEFORE
  // streaming the body into worker memory. Stops trivial OOM attempts.
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > 2_000_000) {
    return c.json({ error: { code: "TOO_LARGE", message: "max 2MB" } }, 413);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength > 2_000_000) {
    return c.json({ error: { code: "TOO_LARGE", message: "max 2MB" } }, 413);
  }
  await c.env.UPLOADS.put(key, body, { httpMetadata: { contentType: ct } });
  const publicUrl = `${new URL(c.req.url).origin}/uploads/${key}`;
  // ONLY update user.image when this was an avatar upload. server_icon
  // uploads MUST NOT touch the uploader's personal avatar — caller is
  // expected to call PATCH /api/v1/servers/:id { iconUrl } afterwards.
  if (isAvatar) {
    const db = drizzle(c.env.DB);
    await db.update(user).set({ image: publicUrl, updatedAt: new Date() }).where(eq(user.id, subject.userId));
  }
  return c.json({ ok: true, publicUrl });
});

// ---------------------------------------------------------------------------
// POST /api/v1/uploads/message-attachment — upload bytes for a message
//
// Single-shot upload: client streams the file in the request body and we
// write it to R2 + record metadata. Returns `attachmentId`, which the
// client passes via `attachmentIds: [id]` in the next POST /messages call.
//
// Pre-flight headers (set on the request):
//   x-raltic-channel-id    — target channel (required for membership + archive check)
//   x-raltic-filename      — original filename (URL-encoded UTF-8)
//   content-type           — file MIME type (allowlist-gated)
//   content-length         — declared size (pre-flight quota check)
//
// Gates (in order):
//   1. requireAuth + requireUser (no machine-key uploads)
//   2. channel membership via policy.channels.canAddMember
//      (participants only — public-channel readers can't drop files in)
//   3. channel not archived
//   4. MIME in allowlist
//   5. content-length ≤ 25 MB
//   6. per-user 24h quota check (against existing attachments.sizeBytes)
//   7. per-user rate limit (60/hr)
// ---------------------------------------------------------------------------
uploadsRoutes.post("/api/v1/uploads/message-attachment", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  const channelId = c.req.header("x-raltic-channel-id");
  const filenameRaw = c.req.header("x-raltic-filename");
  const contentType = c.req.header("content-type") ?? "";
  const declared = Number(c.req.header("content-length") ?? "0");
  if (!channelId) return c.json({ error: { code: "BAD_REQ", message: "x-raltic-channel-id required" } }, 400);
  if (!filenameRaw) return c.json({ error: { code: "BAD_REQ", message: "x-raltic-filename required" } }, 400);
  if (!ATTACHMENT_MIME_ALLOW.test(contentType)) {
    return c.json({ error: { code: "BAD_TYPE", message: "unsupported content-type" } }, 415);
  }
  if (declared <= 0) {
    return c.json({ error: { code: "BAD_REQ", message: "content-length required" } }, 411);
  }
  if (declared > ATTACHMENT_MAX_BYTES) {
    return c.json({ error: { code: "TOO_LARGE", message: "max 25 MB per file" } }, 413);
  }
  // Decode + clamp filename. Strip any path separators a client might
  // have left in to prevent confusion later (we never use it as a path,
  // but it's harmless to keep clean).
  let filename: string;
  try {
    filename = decodeURIComponent(filenameRaw).replace(/[/\\]/g, "_").slice(0, 200);
  } catch {
    return c.json({ error: { code: "BAD_REQ", message: "invalid filename encoding" } }, 400);
  }
  if (filename.length === 0) {
    return c.json({ error: { code: "BAD_REQ", message: "filename empty after sanitization" } }, 400);
  }

  // Rate limit + policy gate (canAddMember = participant in this channel).
  const limited = await rateLimit(c, "upload_attachment", subject.userId, 60, 3600);
  if (limited) return limited;
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canAddMember(ctx, channelId));

  // Archive gate — pre-upload check so we don't waste R2 bytes on a
  // file that will be rejected at send time anyway.
  const db = drizzle(c.env.DB);
  const ch = await db.select({ archivedAt: channels.archivedAt }).from(channels)
    .where(eq(channels.id, channelId)).limit(1);
  if (ch[0]?.archivedAt != null) {
    return c.json({ error: { code: "ARCHIVED", message: "channel is archived" } }, 423);
  }

  // 24h rolling per-user quota — sum existing attachment sizes uploaded
  // by this user in the last 24h. Cheap query thanks to
  // ix_attachments_uploader_created.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const quotaRow = await db.select({
    used: sqlFn<number>`COALESCE(SUM(${messageAttachments.sizeBytes}), 0)`,
  }).from(messageAttachments).where(and(
    eq(messageAttachments.uploaderId, subject.userId),
    gt(messageAttachments.createdAt, since),
  ));
  const used = Number(quotaRow[0]?.used ?? 0);
  if (used + declared > ATTACHMENT_QUOTA_BYTES) {
    return c.json({
      error: { code: "QUOTA_EXCEEDED", message: `daily 100 MB quota would be exceeded (${used} bytes used)` },
    }, 429);
  }

  const attachmentId = crypto.randomUUID();
  const r2Key = `attachments/${channelId}/${attachmentId}`;
  const bytes = await c.req.arrayBuffer();
  // Post-flight size check — content-length is a hint, not authoritative.
  // Reject any client that lied about its declared size.
  if (bytes.byteLength > ATTACHMENT_MAX_BYTES || bytes.byteLength === 0) {
    return c.json({ error: { code: "TOO_LARGE", message: "body size mismatch" } }, 413);
  }

  await c.env.UPLOADS.put(r2Key, bytes, {
    httpMetadata: {
      contentType,
      contentDisposition: contentType.startsWith("image/") ? "inline" : `attachment; filename="${filename}"`,
    },
  });
  await db.insert(messageAttachments).values({
    id: attachmentId, messageId: null, channelId,
    uploaderId: subject.userId, r2Key, filename, contentType,
    sizeBytes: bytes.byteLength, width: null, height: null,
    createdAt: new Date(),
  });

  return c.json({
    attachmentId, filename, contentType, sizeBytes: bytes.byteLength,
    // URL the client can render. Served by GET /uploads/attachments/...
    // below, which streams from R2 with safe headers.
    url: `${new URL(c.req.url).origin}/uploads/${r2Key}`,
  });
});

// ---------------------------------------------------------------------------
// GET /uploads/attachments/:channelId/:attachmentId — stream attachment
//
// Gated by channel read access — non-members can't fetch via guessed
// r2Key, even though R2 keys are UUIDs. Belt + braces: we own the read
// path so we can enforce membership without relying on key opacity.
// ---------------------------------------------------------------------------
uploadsRoutes.get("/uploads/attachments/:channelId/:attachmentId", requireAuth, async (c) => {
  const channelId = c.req.param("channelId");
  const attachmentId = c.req.param("attachmentId");
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canRead(ctx, channelId));

  const db = drizzle(c.env.DB);
  const rows = await db.select().from(messageAttachments)
    .where(and(
      eq(messageAttachments.id, attachmentId),
      eq(messageAttachments.channelId, channelId),
    )).limit(1);
  if (rows.length === 0) return c.text("not found", 404);
  const att = rows[0];

  const obj = await c.env.UPLOADS.get(att.r2Key);
  if (!obj) return c.text("not found", 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  // Short cache — files are immutable per attachmentId so we could go
  // longer, but a low max-age keeps storage migrations easier.
  headers.set("cache-control", "private, max-age=300");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  // Sandbox the response so embedded HTML/SVG can't escape.
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox");
  return new Response(obj.body, { headers });
});

uploadsRoutes.get("/uploads/:key{.+}", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  // Public surface: user avatars + workspace icons. Anything else in the
  // bucket is private (future expansion) — refuse to serve unprefixed keys.
  if (!key.startsWith("avatars/") && !key.startsWith("server-icons/")) {
    return c.text("not found", 404);
  }
  const obj = await c.env.UPLOADS.get(key);
  if (!obj) return c.text("not found", 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=300");
  // Defense-in-depth: even though POST/PUT validates content-type, a
  // malicious file with a benign content-type header can still be sniffed
  // by browsers (HTML/SVG embedded in PNG, etc.) and executed in our
  // origin's context. nosniff stops MIME sniffing — image bytes must be
  // honored as images.
  headers.set("X-Content-Type-Options", "nosniff");
  // Avoid framing the image to defeat clickjacking-via-image gadgets
  // where a forged "image" is actually an HTML doc.
  headers.set("X-Frame-Options", "DENY");
  // Conservative CSP for static asset responses — image-or-nothing.
  // If a browser somehow sniffs the body as HTML, no scripts, no styles,
  // no inline anything will be allowed to run. `style-src 'unsafe-inline'`
  // was incoherent for an image response and was widening rather than
  // tightening the surface; removed.
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox");
  return new Response(obj.body, { headers });
});

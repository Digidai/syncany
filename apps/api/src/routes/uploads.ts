import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { uploadAvatarRequest } from "@raltic/protocol";
import { user } from "@raltic/db";
import { eq } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";

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

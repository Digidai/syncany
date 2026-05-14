import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { uploadAvatarRequest } from "@syncany/protocol";
import { user } from "@syncany/db";
import { eq } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth } from "../lib/auth";

export const uploadsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/uploads/avatar — issue a one-shot R2 PUT URL for the user's avatar
// ---------------------------------------------------------------------------
uploadsRoutes.post("/api/v1/uploads/avatar", requireAuth, async (c) => {
  const body = uploadAvatarRequest.parse(await c.req.json());
  const subject = c.get("subject");
  const key = `avatars/${subject.userId}/${crypto.randomUUID()}`;
  // R2 doesn't ship with presigned PUT in Workers runtime; we proxy uploads
  // through the api Worker instead. Return the upload endpoint URL — the
  // client POSTs the file there with the Bearer token still attached.
  return c.json({
    uploadUrl: `${new URL(c.req.url).origin}/api/v1/uploads/r2/${encodeURIComponent(key)}`,
    publicUrl: `${new URL(c.req.url).origin}/uploads/${key}`,
    key,
  });
});

uploadsRoutes.put("/api/v1/uploads/r2/:key{.+}", requireAuth, async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  const subject = c.get("subject");
  if (!key.startsWith(`avatars/${subject.userId}/`)) {
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
  // Update user.image to the public URL.
  const publicUrl = `${new URL(c.req.url).origin}/uploads/${key}`;
  const db = drizzle(c.env.DB);
  await db.update(user).set({ image: publicUrl, updatedAt: new Date() }).where(eq(user.id, subject.userId));
  return c.json({ ok: true, publicUrl });
});

uploadsRoutes.get("/uploads/:key{.+}", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  // Public surface: avatars only. Anything else in the bucket is private
  // (future expansion) — refuse to serve unprefixed keys.
  if (!key.startsWith("avatars/")) {
    return c.text("not found", 404);
  }
  const obj = await c.env.UPLOADS.get(key);
  if (!obj) return c.text("not found", 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=300");
  return new Response(obj.body, { headers });
});

import { Hono } from "hono";
import type { Env, Variables } from "../lib/env";

export const internalRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /internal/seed-channel — server-to-server call from web Worker (which has
// no CHAT_ROOM DO binding) to seed welcome messages into a fresh channel.
// Authenticated by the shared CHAT_ROOM_AUTH_SECRET.
// ---------------------------------------------------------------------------
internalRoutes.post("/internal/seed-channel", async (c) => {
  const s = c.env.CHAT_ROOM_AUTH_SECRET;
  // Fail-closed: undefined or short secret denies all callers.
  if (!s || typeof s !== "string" || s.length < 16) {
    return c.json({ error: { code: "FORBIDDEN", message: "bad secret" } }, 403);
  }
  if (c.req.header("x-internal-secret") !== s) {
    return c.json({ error: { code: "FORBIDDEN", message: "bad secret" } }, 403);
  }
  const body = await c.req.json() as {
    channelId: string;
    messages: Array<{ id: string; senderId: string; senderType: "human" | "agent" | "system"; content: string; threadParentId: string | null }>;
  };
  const stub = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(body.channelId));
  const res = await stub.fetch("https://chat-room/internal/seed", {
    method: "POST",
    headers: { "x-internal-secret": c.env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
    body: JSON.stringify({
      channelId: body.channelId,
      messages: body.messages.map(m => ({ ...m, channelId: body.channelId })),
    }),
  });
  return c.json({ ok: res.ok });
});

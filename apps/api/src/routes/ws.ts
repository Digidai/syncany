import { Hono } from "hono";
import { requirePolicy, policy, signWsToken } from "@syncany/auth-core";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";

export const wsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// WS token mint — short-lived JWT for channel WS upgrade
// ---------------------------------------------------------------------------
wsRoutes.post("/api/v1/ws/token", requireAuth, async (c) => {
  const body = await c.req.json() as { channelId?: string; scope?: "channel" | "gateway" };
  const subject = c.get("subject");
  const scope = body.scope ?? (body.channelId ? "channel" : "gateway");

  if (scope === "channel") {
    if (!body.channelId) return c.json({ error: { code: "BAD_REQ", message: "channelId required" } }, 400);
    const ctx = ctxFor(c);
    await requirePolicy(policy.channels.canRead(ctx, body.channelId));
    const token = await signWsToken(c.env.CHAT_ROOM_AUTH_SECRET, {
      sub: subject.userId, channelId: body.channelId, agents: [], ttlSeconds: 60 * 10,
    });
    return c.json({ token, wsUrl: new URL(c.req.url).origin.replace(/^http/, "ws") });
  }

  // Gateway scope: no channel binding — just user identity for cross-channel events.
  const token = await signWsToken(c.env.CHAT_ROOM_AUTH_SECRET, {
    sub: subject.userId, agents: [], ttlSeconds: 60 * 10,
  });
  return c.json({ token, wsUrl: new URL(c.req.url).origin.replace(/^http/, "ws") });
});

// ---------------------------------------------------------------------------
// WebSocket upgrade routes
// ---------------------------------------------------------------------------
wsRoutes.get("/ws/channel/:id", async (c) => {
  const channelId = c.req.param("id");
  if (c.req.header("upgrade") !== "websocket") {
    return c.text("expected websocket", 426);
  }
  const stub = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(channelId));
  return stub.fetch(`https://chat-room/ws?channelId=${channelId}`, c.req.raw);
});

wsRoutes.get("/ws/user/:userId", async (c) => {
  const userId = c.req.param("userId");
  if (c.req.header("upgrade") !== "websocket") {
    return c.text("expected websocket", 426);
  }
  // The DO will also verify the token, but we forward the userId in the
  // synthetic URL so the DO can assert claims.userId === expected. Defense
  // in depth against an attacker swapping the URL userId.
  const stub = c.env.USER_GATEWAY.get(c.env.USER_GATEWAY.idFromName(userId));
  return stub.fetch(`https://user-gateway/ws?expectedUserId=${encodeURIComponent(userId)}`, c.req.raw);
});

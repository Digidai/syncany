import { Hono } from "hono";
import { z } from "zod";
import { requirePolicy, policy, signWsToken } from "@raltic/auth-core";
import type { Env, Variables } from "../lib/env";
import { requireAuth, requireUser, ctxFor } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";

export const wsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Strict body schema — replaces an unchecked JSON cast that accepted
// unknown scopes (anything not literally "channel" silently became
// "gateway", which let machine subjects mint user-identity gateway
// tokens via this route).
const wsTokenBody = z.object({
  channelId: z.string().min(1).max(128).optional(),
  scope: z.enum(["channel", "gateway"]).optional(),
});

// ---------------------------------------------------------------------------
// WS token mint — short-lived JWT for channel WS upgrade
// ---------------------------------------------------------------------------
wsRoutes.post("/api/v1/ws/token", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  // 120 mints/min/user — normal SPA opens one per channel + one per
  // gateway per page load; cap bounds token-grinding via leaked cookie.
  const limited = await rateLimit(c, "ws_token", subject.userId, 120, 60);
  if (limited) return limited;
  const body = wsTokenBody.parse(await c.req.json().catch(() => ({})));
  const scope = body.scope ?? (body.channelId ? "channel" : "gateway");

  if (scope === "channel") {
    if (!body.channelId) return c.json({ error: { code: "BAD_REQ", message: "channelId required" } }, 400);
    const ctx = ctxFor(c);
    await requirePolicy(policy.channels.canRead(ctx, body.channelId));
    const token = await signWsToken(c.env.CHAT_ROOM_AUTH_SECRET, {
      sub: subject.userId, aud: "channel", channelId: body.channelId, agents: [], ttlSeconds: 60 * 10,
    });
    return c.json({ token, wsUrl: new URL(c.req.url).origin.replace(/^http/, "ws") });
  }

  // Gateway scope: no channel binding — just user identity for cross-
  // channel events (UserGateway DO). HUMAN SESSIONS ONLY: bridge tokens
  // and machine keys must not be allowed to mint a gateway-scope token
  // pretending to be the user, since that would let a compromised
  // bridge subscribe to the user's cross-channel notifications stream.
  if (subject.kind !== "user") {
    return c.json({ error: { code: "FORBIDDEN", message: "gateway tokens require a human session" } }, 403);
  }
  const token = await signWsToken(c.env.CHAT_ROOM_AUTH_SECRET, {
    sub: subject.userId, aud: "gateway", agents: [], ttlSeconds: 60 * 10,
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

import { drizzle } from "drizzle-orm/d1";
import {
  newAuthCtx, type Subject, type AuthCtx,
  resolveMachineKey, verifyWsToken, isTokenRevoked,
} from "@syncany/auth-core";
import type { Ctx, Env } from "./env";
import type { MiddlewareHandler } from "hono";

/**
 * Resolve the acting subject from `Authorization: Bearer …`. Three forms:
 *   - `ck_…`           machine key (bridge / CLI bootstrap)
 *   - `sy_api_…`       short-lived (5 min) HMAC token from web client
 *   - `sy_bridge_…`    bridge wsToken (HMAC JWT, 7 d)
 *
 * Returns `null` for unknown / expired / revoked tokens.
 */
export async function resolveSubject(c: Ctx): Promise<Subject | null> {
  const authz = c.req.header("authorization") ?? "";

  if (authz.startsWith("Bearer ck_")) {
    const apiKey = authz.slice("Bearer ".length);
    const mk = await resolveMachineKey(c.env, apiKey);
    if (!mk) return null;
    return { kind: "machine", userId: mk.userId, serverId: mk.serverId, keyId: mk.id };
  }

  if (authz.startsWith("Bearer sy_api_")) {
    const token = authz.slice("Bearer sy_api_".length);
    const claims = await verifyWsToken(token, c.env.CHAT_ROOM_AUTH_SECRET);
    if (!claims) return null;
    // Same revocation surface as bridge tokens — a leaked sy_api_ token
    // can be invalidated by writing its jti into the KV deny-list.
    if (claims.jti && await isTokenRevoked(c.env.RATE_LIMITS, claims.jti)) return null;
    return { kind: "user", userId: claims.sub };
  }

  if (authz.startsWith("Bearer sy_bridge_")) {
    const token = authz.slice("Bearer sy_bridge_".length);
    const claims = await verifyWsToken(token, c.env.CHAT_ROOM_AUTH_SECRET);
    if (!claims) return null;
    if (claims.jti && await isTokenRevoked(c.env.RATE_LIMITS, claims.jti)) return null;
    if (claims.bridgeId && await isTokenRevoked(c.env.RATE_LIMITS, `bridge:${claims.bridgeId}`)) return null;
    return { kind: "user", userId: claims.sub };
  }

  return null;
}

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: { subject: Subject } }> = async (c, next) => {
  const subject = await resolveSubject(c);
  if (!subject) return c.json({ error: { code: "UNAUTHENTICATED", message: "sign in" } }, 401);
  c.set("subject", subject);
  await next();
};

/** Build a per-request authorization context with memoization. */
export function ctxFor(c: Ctx): AuthCtx {
  return newAuthCtx(drizzle(c.env.DB), c.get("subject"));
}

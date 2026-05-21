import { drizzle } from "drizzle-orm/d1";
import {
  newAuthCtx, type Subject, type AuthCtx,
  resolveMachineKey, verifyWsToken, isTokenRevoked,
} from "@raltic/auth-core";
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
    return { kind: "user", userId: claims.sub, via: "api_token" };
  }

  if (authz.startsWith("Bearer sy_bridge_")) {
    const token = authz.slice("Bearer sy_bridge_".length);
    const claims = await verifyWsToken(token, c.env.CHAT_ROOM_AUTH_SECRET);
    if (!claims) return null;
    if (claims.jti && await isTokenRevoked(c.env.RATE_LIMITS, claims.jti)) return null;
    if (claims.bridgeId && await isTokenRevoked(c.env.RATE_LIMITS, `bridge:${claims.bridgeId}`)) return null;
    // `via: "bridge_token"` — requireUser rejects this to prevent a
    // bridge from masquerading as the user it represents on identity-
    // level write paths (e.g. PATCH /me/default-server).
    return { kind: "user", userId: claims.sub, via: "bridge_token" };
  }

  return null;
}

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: { subject: Subject } }> = async (c, next) => {
  const subject = await resolveSubject(c);
  if (!subject) return c.json({ error: { code: "UNAUTHENTICATED", message: "sign in" } }, 401);
  c.set("subject", subject);
  await next();
};

/**
 * Subject-kind guards. Mount AFTER requireAuth on routes that should
 * accept only one subject form. Returns 403 with a stable error code
 * so the web client can render a sensible message.
 *
 * Use over inline `if (subject.kind !== "user") return 403` checks —
 * centralizes the policy, makes audits "grep for requireUser" reliable,
 * and a future change (e.g. promoting service tokens) lands in one
 * place.
 *
 * Note these are MiddlewareHandlers so they sit in `.use()` chains;
 * callers can still inspect `subject` after to discriminate further
 * (e.g. owner vs admin).
 */
export const requireUser: MiddlewareHandler<{ Bindings: Env; Variables: { subject: Subject } }> = async (c, next) => {
  const subject = c.get("subject");
  if (!subject) return c.json({ error: { code: "UNAUTHENTICATED", message: "sign in" } }, 401);
  if (subject.kind !== "user") {
    return c.json({ error: { code: "FORBIDDEN", message: "user session required" } }, 403);
  }
  // Reject bridge-minted tokens on user-only surfaces. A bridge token
  // is the user's WS upgrade credential; allowing it to PATCH the
  // user's identity (e.g. default workspace, profile fields) means a
  // compromised bridge can grief the user's account. Cookie + api_token
  // are the only acceptable ways to act AS the user.
  if (subject.via === "bridge_token") {
    return c.json({ error: { code: "FORBIDDEN", message: "this endpoint requires a human session, not a bridge token" } }, 403);
  }
  await next();
};

export const requireMachine: MiddlewareHandler<{ Bindings: Env; Variables: { subject: Subject } }> = async (c, next) => {
  const subject = c.get("subject");
  if (!subject) return c.json({ error: { code: "UNAUTHENTICATED", message: "sign in" } }, 401);
  if (subject.kind !== "machine") {
    return c.json({ error: { code: "FORBIDDEN", message: "machine key required" } }, 403);
  }
  await next();
};

/** Build a per-request authorization context with memoization. */
export function ctxFor(c: Ctx): AuthCtx {
  return newAuthCtx(drizzle(c.env.DB), c.get("subject"));
}

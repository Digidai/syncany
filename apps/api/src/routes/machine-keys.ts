import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy, issueMachineKey, revokeToken } from "@syncany/auth-core";
import { createMachineKeyRequest } from "@syncany/protocol";
import { machineKeys } from "@syncany/db";
import { and, eq } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";

export const machineKeysRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

machineKeysRoutes.delete("/api/v1/machine-keys/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  const ctx = ctxFor(c);
  await requirePolicy(policy.machineKeys.canRevoke(ctx, subject.userId));
  const db = drizzle(c.env.DB);
  await db.update(machineKeys).set({ revokedAt: new Date() })
    .where(and(eq(machineKeys.id, id), eq(machineKeys.userId, subject.userId)));
  // Also revoke any outstanding bridge JWTs minted from this key. We don't
  // track every issued jti, so as a best-effort we add the machine-key id to
  // a denylist keyed by `bridgeId` — `resolveSubject` checks both jti AND
  // bridgeId. Drops the existing bridge's auth immediately on next request.
  await revokeToken(c.env.RATE_LIMITS, `bridge:${id}`);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/v1/machine-keys — create + list + revoke
// ---------------------------------------------------------------------------
machineKeysRoutes.post("/api/v1/machine-keys", requireAuth, async (c) => {
  const subject = c.get("subject");
  const limited = await rateLimit(c, "key_create", subject.userId, 10, 3600); // 10/hour/user
  if (limited) return limited;
  const body = createMachineKeyRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  await requirePolicy(policy.machineKeys.canCreate(ctx));
  const issued = await issueMachineKey(c.env, {
    userId: subject.userId, serverId: body.serverId, name: body.name,
  });
  return c.json({
    id: issued.id, apiKey: issued.apiKey, name: body.name, createdAt: Date.now(),
  });
});

machineKeysRoutes.get("/api/v1/machine-keys", requireAuth, async (c) => {
  const subject = c.get("subject");
  // Listing keys is a sensitive operation — only the user themselves
  // (cookie session, not a machine key bearer) can enumerate their keys.
  // A leaked machine key must NOT be able to list other keys.
  if (subject.kind !== "user") {
    return c.json({ error: { code: "FORBIDDEN", message: "user session required" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const rows = await db.select({
    id: machineKeys.id, prefix: machineKeys.keyPrefix, name: machineKeys.name,
    createdAt: machineKeys.createdAt, lastUsedAt: machineKeys.lastUsedAt,
    revokedAt: machineKeys.revokedAt,
  }).from(machineKeys).where(eq(machineKeys.userId, subject.userId));
  return c.json({ keys: rows });
});

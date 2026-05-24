import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy, issueMachineKey, revokeToken } from "@raltic/auth-core";
import { createMachineKeyRequest, detectedRuntimeSnapshot } from "@raltic/protocol";
import { machineKeys } from "@raltic/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Env, Variables } from "../lib/env";
import { requireAuth, requireUser, ctxFor } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";

/** Shape of the persisted runtime snapshot.
 *
 *  IMPORTANT: read-side is INTENTIONALLY LOOSER than the write-side
 *  (`detectedRuntimeSnapshot`). If a future bridge version writes a new
 *  runtime id (e.g. "gemini"), strict zod-parse would fail the WHOLE
 *  record and silently wipe valid claude/codex entries. Use a permissive
 *  `id: z.string()` here so unknown runtimes pass through; the UI filters
 *  by known ids and ignores anything it doesn't render. */
const persistedRuntime = z.object({
  id: z.string().max(32),
  detected: z.boolean().nullable().optional(),
  version: z.string().max(64).nullable().optional(),
  authed: z.boolean().nullable().optional(),
  authMethod: z.string().max(16).nullable().optional(),
  error: z.string().max(512).nullable().optional(),
});
const persistedSnapshot = z.record(z.string(), z.object({
  runtimes: z.array(persistedRuntime),
  detectedAt: z.number().int(),
  hostname: z.string().optional(),
  platform: z.string().optional(),
  arch: z.string().optional(),
}));

export const machineKeysRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

machineKeysRoutes.delete("/api/v1/machine-keys/:id", requireAuth, requireUser, async (c) => {
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
machineKeysRoutes.post("/api/v1/machine-keys", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  const limited = await rateLimit(c, "key_create", subject.userId, 10, 3600); // 10/hour/user
  if (limited) return limited;
  const body = createMachineKeyRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  // Scope check requires the body — caller MUST be a member of `body.serverId`.
  // Previously canCreate only checked subject.kind === "user", which let any
  // signed-in user mint a key for any known server.
  await requirePolicy(policy.machineKeys.canCreate(ctx, body.serverId));
  const issued = await issueMachineKey(c.env, {
    userId: subject.userId, serverId: body.serverId, name: body.name,
  });
  return c.json({
    id: issued.id, apiKey: issued.apiKey, name: body.name, createdAt: Date.now(),
  });
});

machineKeysRoutes.get("/api/v1/machine-keys", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  // Listing keys is a sensitive operation — only the user themselves
  // (cookie session, not a machine key bearer) can enumerate their
  // keys. A leaked machine key must NOT be able to list other keys.
  // Gated by requireUser above.
  // Optional ?serverId=... scopes the list to a single workspace. Required
  // for the settings/keys tab so it doesn't surface keys from other
  // workspaces the user is in. Validated via canRead so the caller can't
  // probe for workspaces they don't belong to.
  const scopeServerId = c.req.query("serverId");
  if (scopeServerId) {
    const ctx = ctxFor(c);
    await requirePolicy(policy.servers.canRead(ctx, scopeServerId));
  }
  const db = drizzle(c.env.DB);
  const conds = [eq(machineKeys.userId, subject.userId)];
  if (scopeServerId) conds.push(eq(machineKeys.serverId, scopeServerId));
  const rows = await db.select({
    id: machineKeys.id, prefix: machineKeys.keyPrefix, name: machineKeys.name,
    serverId: machineKeys.serverId,
    createdAt: machineKeys.createdAt, lastUsedAt: machineKeys.lastUsedAt,
    revokedAt: machineKeys.revokedAt,
    lastDetectedRuntimes: machineKeys.lastDetectedRuntimes,
    lastDetectedAt: machineKeys.lastDetectedAt,
  }).from(machineKeys).where(and(...conds));

  // Project runtime snapshots into the response shape consumers expect.
  // Map: { [machineFingerprint]: { runtimes, detectedAt, hostname } } →
  // array of `{ fingerprint, runtimes, detectedAt, hostname }`. Read-side
  // safeParse gracefully drops bad shapes (older bridge versions).
  return c.json({
    keys: rows.map((r) => {
      const machines = projectSnapshot(r.lastDetectedRuntimes);
      return {
        id: r.id,
        prefix: r.prefix,
        name: r.name,
        serverId: r.serverId,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        revokedAt: r.revokedAt,
        lastDetectedAt: r.lastDetectedAt,
        // Empty array when never connected OR shape drift fallback.
        machines,
      };
    }),
  });
});

function projectSnapshot(raw: unknown): Array<{
  fingerprint: string;
  hostname: string | null;
  platform: string | null;
  arch: string | null;
  detectedAt: number;
  // Loose-typed runtimes — id may be a future runtime string we don't
  // know about; UI filters by recognised ids. See `persistedRuntime`
  // for the read-side schema.
  runtimes: Array<z.infer<typeof persistedRuntime>>;
}> {
  if (!raw || typeof raw !== "object") return [];
  const parsed = persistedSnapshot.safeParse(raw);
  if (!parsed.success) return [];
  return Object.entries(parsed.data).map(([fingerprint, v]) => ({
    fingerprint,
    hostname: v.hostname ?? null,
    platform: v.platform ?? null,
    arch: v.arch ?? null,
    detectedAt: v.detectedAt,
    runtimes: v.runtimes,
  }));
}

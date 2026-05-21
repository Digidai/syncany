import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { resolveMachineKey, signWsToken } from "@raltic/auth-core";
import { bridgeConnectRequest, bridgeConnectResponse, type DetectedRuntimeSnapshot } from "@raltic/protocol";
import { agents, channels, channelMembers, machineKeys, serverMembers } from "@raltic/db";
import { and, eq } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { rateLimit, clientIp } from "../lib/rate-limit";
import { requireAuth, requireMachine } from "../lib/auth";

export const bridgeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Per-machine-fingerprint snapshot map persisted on machine_keys row.
 *  Keyed by stable hash from bridge so multiple bridges sharing a key
 *  don't overwrite each other. Old entries (>30d) GC'd at write time. */
type MachineRuntimeSnapshot = {
  runtimes: DetectedRuntimeSnapshot[];
  detectedAt: number;
  hostname?: string;
  platform?: string;
  arch?: string;
};
type SnapshotMap = Record<string /* machineFingerprint */, MachineRuntimeSnapshot>;

const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;     // 30 days
const MAX_FINGERPRINTS = 16;                            // hard cap to bound JSON size

// ---------------------------------------------------------------------------
// Bridge auth: trade machine key for ws token + bootstrap data
// ---------------------------------------------------------------------------
bridgeRoutes.post("/api/v1/bridge/connect", async (c) => {
  const limited = await rateLimit(c, "bridge_connect", clientIp(c), 60, 60); // 60/min/IP
  if (limited) return limited;
  const body = bridgeConnectRequest.parse(await c.req.json());
  const mk = await resolveMachineKey(c.env, body.apiKey);
  if (!mk) return c.json({ error: { code: "BAD_KEY", message: "invalid api key" } }, 401);

  // SECURITY (defense-in-depth): refuse if the key's owner is no longer a
  // member of the bound server. cleanupServerMembership in servers.ts
  // already revokes machine keys on leave/kick, so this only catches the
  // edge case where revocation got skipped (partial failure, future bug,
  // or pre-existing keys created before the cleanup logic shipped). The
  // 403 boots any live bridge for an ex-member on next /connect, even if
  // the key itself wasn't marked revoked.
  const db = drizzle(c.env.DB);
  const stillMember = await db
    .select({ id: serverMembers.serverId })
    .from(serverMembers)
    .where(and(
      eq(serverMembers.serverId, mk.serverId),
      eq(serverMembers.memberId, mk.userId),
      eq(serverMembers.memberType, "human"),
    ))
    .limit(1);
  if (stillMember.length === 0) {
    return c.json({ error: { code: "NOT_A_MEMBER", message: "key owner is no longer a workspace member" } }, 403);
  }

  // SECURITY: filter by mk.serverId, NOT just mk.userId. A user with multiple
  // servers must NOT be able to use serverA's machine key to operate on
  // serverB's agents/channels. Cross-server isolation is enforced here.
  const [myAgents, myChannels] = await Promise.all([
    db.select().from(agents).where(
      and(eq(agents.ownerId, mk.userId), eq(agents.serverId, mk.serverId)),
    ),
    db.select({ ch: channels, agentId: channelMembers.memberId })
      .from(channels)
      .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
      .innerJoin(agents, eq(agents.id, channelMembers.memberId))
      .where(and(
        eq(agents.ownerId, mk.userId),
        eq(agents.serverId, mk.serverId),
        eq(channels.serverId, mk.serverId),
      )),
  ]);

  type ChannelType = typeof channels.$inferSelect["type"];
  const channelMap = new Map<string, { id: string; name: string; type: ChannelType; agentIds: string[] }>();
  for (const row of myChannels) {
    const existing = channelMap.get(row.ch.id);
    if (existing) existing.agentIds.push(row.agentId);
    else channelMap.set(row.ch.id, { id: row.ch.id, name: row.ch.name, type: row.ch.type, agentIds: [row.agentId] });
  }

  const wsToken = await signWsToken(c.env.CHAT_ROOM_AUTH_SECRET, {
    sub: mk.userId,
    agents: myAgents.map(a => a.id),
    bridgeId: mk.id,
    ttlSeconds: 60 * 60 * 24 * 7,
  });

  // Persist runtime snapshot for Settings + Wizard surfaces. Best-effort —
  // failure here MUST NOT break /connect (bridge would retry forever).
  if (body.runtimes && body.runtimes.length > 0) {
    c.executionCtx.waitUntil(
      persistRuntimeSnapshot(c.env, mk.id, body).catch((e) => {
        console.warn("[bridge.connect] snapshot persist failed:", e);
      }),
    );
  }

  // Build the response then zod-parse it before returning — catches
  // accidental shape drift (e.g. forgot to add `runtime` to agents).
  const responseBody = {
    wsUrl: new URL(c.req.url).origin.replace(/^http/, "ws"),
    token: wsToken,
    userId: mk.userId,
    serverId: mk.serverId,
    agents: myAgents.map(a => ({
      id: a.id, name: a.name, displayName: a.displayName,
      systemPrompt: a.systemPrompt, model: a.model,
      runtime: a.runtime,
    })),
    channels: Array.from(channelMap.values()),
  };
  const parsed = bridgeConnectResponse.safeParse(responseBody);
  if (!parsed.success) {
    console.error("[bridge.connect] response failed self-parse:", parsed.error.message);
    return c.json({ error: { code: "INTERNAL", message: "response shape error" } }, 500);
  }
  return c.json(parsed.data);
});

async function persistRuntimeSnapshot(
  env: Env,
  machineKeyId: string,
  body: { runtimes?: DetectedRuntimeSnapshot[]; machineFingerprint?: string; hostname?: string; platform?: string; arch?: string },
): Promise<void> {
  const db = drizzle(env.DB);
  const row = await db
    .select({ existing: machineKeys.lastDetectedRuntimes })
    .from(machineKeys)
    .where(eq(machineKeys.id, machineKeyId))
    .limit(1);

  let snap: SnapshotMap = {};
  const raw = row[0]?.existing;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    snap = raw as SnapshotMap;
  }

  // GC entries older than TTL.
  const now = Date.now();
  for (const [fp, entry] of Object.entries(snap)) {
    if (!entry || typeof entry.detectedAt !== "number" || now - entry.detectedAt > SNAPSHOT_TTL_MS) {
      delete snap[fp];
    }
  }

  const fp = (body.machineFingerprint || "default").slice(0, 64);
  snap[fp] = {
    runtimes: body.runtimes ?? [],
    detectedAt: now,
    hostname: body.hostname?.slice(0, 128),
    platform: body.platform?.slice(0, 32),
    arch: body.arch?.slice(0, 16),
  };

  // Cap dict size — keep newest N.
  const keys = Object.keys(snap);
  if (keys.length > MAX_FINGERPRINTS) {
    const sorted = keys.sort((a, b) => snap[b].detectedAt - snap[a].detectedAt);
    const evict = new Set(sorted.slice(MAX_FINGERPRINTS));
    for (const k of evict) delete snap[k];
  }

  await db
    .update(machineKeys)
    .set({ lastDetectedRuntimes: snap, lastDetectedAt: new Date(now) })
    .where(eq(machineKeys.id, machineKeyId));
}

// ---------------------------------------------------------------------------
// POST /api/v1/bridge/heartbeat — lightweight liveness ping
//
// Bridge calls this every 60s while running. Updates machine_keys
// .last_used_at so Settings → Machine API keys can render an "Active
// <Nm ago>" badge instead of leaving users guessing whether the bridge
// is up. Heavier `/connect` is too expensive to call this frequently
// (issues WS tokens, lists agents + channels); heartbeat is just a
// timestamp poke.
//
// Auth: machine-key bearer only (requireMachine). Cookie sessions
// don't have a bridgeId to associate liveness with.
// ---------------------------------------------------------------------------
bridgeRoutes.post("/api/v1/bridge/heartbeat", requireAuth, requireMachine, async (c) => {
  const subject = c.get("subject");
  // requireMachine narrows at runtime but Hono's MiddlewareHandler
  // generic doesn't propagate that through to the handler's subject
  // type. Local cast is safe because the middleware already 403'd
  // anything non-machine before this line.
  if (subject.kind !== "machine") {
    return c.json({ error: { code: "FORBIDDEN", message: "machine key required" } }, 403);
  }
  // 240/min/key — bridge sends 1/min normally; bursts during retry are
  // bounded by this. Beyond the cap = misbehaving client.
  const limited = await rateLimit(c, "bridge_heartbeat", subject.keyId, 240, 60);
  if (limited) return limited;

  const db = drizzle(c.env.DB);
  await db.update(machineKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(machineKeys.id, subject.keyId));
  return c.json({ ok: true, t: Date.now() });
});

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@syncany/auth-core";
import { servers, serverMembers, channels, channelMembers, messages, machineKeys } from "@syncany/db";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";

export const meRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/agent-activity — bridge POSTs activity events; fanout via UserGateway
// ---------------------------------------------------------------------------
meRoutes.post("/api/v1/agent-activity", requireAuth, async (c) => {
  const subject = c.get("subject");
  const body = await c.req.json() as { agentId: string; status: string; label?: string; detail?: string };
  // Verify the agent is actually owned by this subject's user.
  const ctx = ctxFor(c);
  await requirePolicy(policy.agents.canUpdate(ctx, body.agentId));

  const stub = c.env.USER_GATEWAY.get(c.env.USER_GATEWAY.idFromName(subject.userId));
  await stub.fetch("https://user-gateway/internal/notify", {
    method: "POST",
    headers: { "x-internal-secret": c.env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
    body: JSON.stringify({
      v: 1, t: "activity",
      agentId: body.agentId,
      status: body.status,
      label: body.label ?? "",
      detail: body.detail ?? "",
    }),
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/v1/agent/messages/check — poll for messages since cursor (CLI)
// ---------------------------------------------------------------------------
meRoutes.get("/api/v1/agent/messages/check", requireAuth, async (c) => {
  const agentId = c.req.query("agentId");
  if (!agentId) return c.json({ error: { code: "BAD_REQ", message: "agentId required" } }, 400);
  const ctx = ctxFor(c);
  await requirePolicy(policy.agents.canRead(ctx, agentId));

  const since = Number(c.req.query("since") ?? 0);
  const db = drizzle(c.env.DB);
  // Don't echo the agent's own messages back to itself.
  const conds = [
    eq(channelMembers.memberId, agentId),
    eq(channelMembers.memberType, "agent"),
  ];
  if (since > 0) conds.push(gt(messages.createdAt, new Date(since)));
  const rows = await db
    .select({ m: messages, channel: channels.name, channelType: channels.type })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .innerJoin(channelMembers, eq(channelMembers.channelId, messages.channelId))
    .where(and(...conds))
    .orderBy(desc(messages.createdAt))
    .limit(50);
  const filtered = rows.filter(r => r.m.senderId !== agentId);
  const cursor = filtered.reduce((m, r) => Math.max(m, r.m.createdAt instanceof Date ? r.m.createdAt.getTime() : Number(r.m.createdAt)), since);
  return c.json({ messages: filtered, cursor });
});

// ---------------------------------------------------------------------------
// /api/v1/me — sanity check + bootstrap data for the web UI.
// hasConnectedBridge tells the onboarding wizard whether the user has ever
// successfully run `syncany bridge` (machine_keys.last_used_at is set).
// ---------------------------------------------------------------------------
meRoutes.get("/api/v1/me", requireAuth, async (c) => {
  const subject = c.get("subject");
  // Bootstrap data is for human-session UI only. A machine key bearer hitting
  // /me would be enumerating all the user's servers, leaking serverB metadata
  // through a serverA key. Block — bridges already get their own bootstrap
  // payload via /api/v1/bridge/connect.
  if (subject.kind !== "user") {
    return c.json({ error: { code: "FORBIDDEN", message: "user session required" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const ownedServers = await db
    .select()
    .from(servers)
    .innerJoin(serverMembers, and(
      eq(serverMembers.serverId, servers.id),
      eq(serverMembers.memberId, subject.userId),
      eq(serverMembers.memberType, "human"),
    ));
  const everUsed = await db
    .select({ id: machineKeys.id })
    .from(machineKeys)
    .where(and(eq(machineKeys.userId, subject.userId), isNotNull(machineKeys.lastUsedAt)))
    .limit(1);
  return c.json({
    subject,
    servers: ownedServers,
    hasConnectedBridge: everUsed.length > 0,
  });
});

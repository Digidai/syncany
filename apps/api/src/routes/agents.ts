import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@syncany/auth-core";
import { createAgentRequest } from "@syncany/protocol";
import { agents, channels, channelMembers } from "@syncany/db";
import { and, eq, sql as sqlFn } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";

export const agentsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/agents — list mine, with each row's DM channel id (if any) so
// the sidebar can link agents directly to their DM. SQL subquery picks
// the DM channel that has both the user AND this agent as members.
// ---------------------------------------------------------------------------
agentsRoutes.get("/api/v1/agents", requireAuth, async (c) => {
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  const where = subject.kind === "machine"
    ? and(eq(agents.ownerId, subject.userId), eq(agents.serverId, subject.serverId))
    : eq(agents.ownerId, subject.userId);

  // Fetch agents + DM channel id in two cheap queries (D1 doesn't optimize
  // correlated subqueries well).
  const rows = await db.select().from(agents).where(where);
  if (rows.length === 0) return c.json({ agents: [] });

  // For each agent, find the DM channel that has BOTH the user AND the
  // agent as members. There's typically exactly one (created by POST /agents).
  const ids = rows.map(r => r.id);
  const dmRows = await db
    .select({ agentId: channelMembers.memberId, channelId: channels.id })
    .from(channels)
    .innerJoin(channelMembers, and(
      eq(channelMembers.channelId, channels.id),
      eq(channelMembers.memberType, "agent"),
    ))
    .where(and(
      eq(channels.type, "dm"),
      sqlFn`${channels.id} IN (
        SELECT channel_id FROM channel_members
        WHERE member_id = ${subject.userId} AND member_type = 'human'
      )`,
    ));
  const dmByAgent = new Map<string, string>();
  for (const r of dmRows) {
    if (ids.includes(r.agentId)) dmByAgent.set(r.agentId, r.channelId);
  }

  return c.json({
    agents: rows.map(r => ({ ...r, dmChannelId: dmByAgent.get(r.id) ?? null })),
  });
});

// ---------------------------------------------------------------------------
// /api/v1/agents
// ---------------------------------------------------------------------------
agentsRoutes.post("/api/v1/agents", requireAuth, async (c) => {
  const body = createAgentRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  const subject = c.get("subject");
  await requirePolicy(policy.agents.canCreate(ctx, body.serverId));
  const db = drizzle(c.env.DB);
  const id = crypto.randomUUID();
  const dmChannelId = crypto.randomUUID();
  const now = new Date();
  // Atomic batch: create the agent + a DM channel with user+agent as
  // members. Without the DM channel users have nowhere to talk to a new
  // agent until they manually add it to some other channel.
  await db.batch([
    db.insert(agents).values({
      id, serverId: body.serverId, ownerId: subject.userId,
      name: body.name, displayName: body.displayName,
      description: body.description ?? null,
      systemPrompt: body.systemPrompt ?? null,
      model: body.model, status: "offline",
      createdAt: now, updatedAt: now,
    }),
    db.insert(channels).values({
      id: dmChannelId,
      serverId: body.serverId,
      name: body.displayName,           // sidebar label = agent's display name
      description: `Direct messages with ${body.displayName}`,
      type: "dm",
      createdBy: subject.userId,
      createdAt: now,
    }),
    db.insert(channelMembers).values([
      { channelId: dmChannelId, memberId: subject.userId, memberType: "human", joinedAt: now },
      { channelId: dmChannelId, memberId: id, memberType: "agent", joinedAt: now },
    ]),
  ]);
  return c.json({ id, dmChannelId });
});

agentsRoutes.patch("/api/v1/agents/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ctx = ctxFor(c);
  await requirePolicy(policy.agents.canUpdate(ctx, id));
  const body = await c.req.json() as Partial<{ displayName: string; description: string | null; systemPrompt: string | null; model: "opus" | "sonnet" | "haiku" }>;
  const db = drizzle(c.env.DB);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.displayName !== undefined) patch.displayName = body.displayName;
  if (body.description !== undefined) patch.description = body.description;
  if (body.systemPrompt !== undefined) patch.systemPrompt = body.systemPrompt;
  if (body.model !== undefined) patch.model = body.model;
  await db.update(agents).set(patch).where(eq(agents.id, id));
  return c.json({ ok: true });
});

agentsRoutes.delete("/api/v1/agents/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ctx = ctxFor(c);
  await requirePolicy(policy.agents.canDelete(ctx, id));
  const db = drizzle(c.env.DB);

  // Find the DM channel(s) this agent was a member of — those are now
  // orphaned (a single-human DM with no peer). Drop them so the sidebar
  // doesn't show dead "Direct messages with <agent>" entries.
  const dmRows = await db
    .select({ channelId: channels.id })
    .from(channels)
    .innerJoin(channelMembers, and(
      eq(channelMembers.channelId, channels.id),
      eq(channelMembers.memberId, id),
      eq(channelMembers.memberType, "agent"),
    ))
    .where(eq(channels.type, "dm"));
  const dmChannelIds = dmRows.map(r => r.channelId);

  // Two sequential awaits — D1 has no transaction across batched
  // statements anyway, and we don't need atomicity here (a partial
  // failure leaves orphan rows that a re-run cleans up).
  await db.delete(channelMembers).where(and(
    eq(channelMembers.memberId, id), eq(channelMembers.memberType, "agent"),
  ));
  for (const cid of dmChannelIds) {
    // FK cascade on channel_members.channelId handles its own membership rows.
    await db.delete(channels).where(eq(channels.id, cid));
  }
  await db.delete(agents).where(eq(agents.id, id));
  return c.json({ ok: true, removedDmChannels: dmChannelIds.length });
});

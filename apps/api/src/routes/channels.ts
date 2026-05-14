import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@syncany/auth-core";
import { listMessagesQuery, createChannelRequest, markReadRequest } from "@syncany/protocol";
import { servers, serverMembers, agents, channels, channelMembers, messages, reactions } from "@syncany/db";
import { and, desc, eq, lt, inArray, sql as sqlFn } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";
import { notifyGateway } from "../lib/notify";

export const channelsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/channels/:id/read — bump last_read_seq
// ---------------------------------------------------------------------------
channelsRoutes.post("/api/v1/channels/:id/read", requireAuth, async (c) => {
  const channelId = c.req.param("id");
  const body = markReadRequest.parse(await c.req.json());
  const subject = c.get("subject");
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canRead(ctx, channelId));
  const db = drizzle(c.env.DB);

  // Clamp to actual max(seq) so a stale/buggy client can't mark read past
  // anything that exists. The actual UPDATE uses SQL `MAX(lastReadSeq, ?)`
  // so multi-tab concurrent writes can't roll the marker backwards even
  // if their requests interleave (no SELECT-then-UPDATE race).
  const maxRow = await db
    .select({ m: sqlFn<number>`COALESCE(MAX(${messages.seq}), 0)` })
    .from(messages).where(eq(messages.channelId, channelId));
  const maxSeq = Number(maxRow[0]?.m ?? 0);
  const requested = Math.min(maxSeq, body.seq);

  await db.update(channelMembers)
    .set({ lastReadSeq: sqlFn`MAX(COALESCE(${channelMembers.lastReadSeq}, 0), ${requested})` })
    .where(and(
      eq(channelMembers.channelId, channelId),
      eq(channelMembers.memberId, subject.userId),
      eq(channelMembers.memberType, "human"),
    ));

  // Read final value back so the response + downstream notify carry the
  // committed seq (which may differ from `requested` if a concurrent tab
  // wrote a higher value first).
  const finalRow = await db
    .select({ s: channelMembers.lastReadSeq })
    .from(channelMembers)
    .where(and(
      eq(channelMembers.channelId, channelId),
      eq(channelMembers.memberId, subject.userId),
      eq(channelMembers.memberType, "human"),
    )).limit(1);
  const next = Number(finalRow[0]?.s ?? requested);

  // Tell every other tab/device of this user via UserGateway so sidebars
  // can clear the badge instantly without re-fetching.
  await notifyGateway(c.env, subject.userId, {
    v: 1, t: "read", channelId, seq: next,
  });
  return c.json({ ok: true, lastReadSeq: next });
});

// ---------------------------------------------------------------------------
// /api/v1/channels/:id/messages — paginated history from D1
// ---------------------------------------------------------------------------
channelsRoutes.get("/api/v1/channels/:id/messages", requireAuth, async (c) => {
  const channelId = c.req.param("id");
  const q = listMessagesQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const ctx = ctxFor(c);
  await requirePolicy(policy.messages.canRead(ctx, channelId));

  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(messages)
    .where(q.before
      ? and(eq(messages.channelId, channelId), lt(messages.seq, q.before))
      : eq(messages.channelId, channelId))
    .orderBy(desc(messages.seq))
    .limit(q.limit);
  // Attach reactions grouped by emoji.
  const ids = rows.map(r => r.id);
  const reactionRows = ids.length === 0 ? [] : await db.select().from(reactions).where(inArray(reactions.messageId, ids));
  const reactionsByMsg = new Map<string, Map<string, string[]>>();
  for (const r of reactionRows) {
    const byEmoji = reactionsByMsg.get(r.messageId) ?? new Map<string, string[]>();
    const list = byEmoji.get(r.emoji) ?? [];
    list.push(r.reactorId);
    byEmoji.set(r.emoji, list);
    reactionsByMsg.set(r.messageId, byEmoji);
  }
  const out = rows.map(m => ({
    ...m,
    reactions: Array.from((reactionsByMsg.get(m.id) ?? new Map()).entries()).map(([emoji, reactorIds]) => ({ emoji, reactorIds })),
  }));
  return c.json({ messages: out.reverse() });
});

channelsRoutes.get("/api/v1/channels/:id", requireAuth, async (c) => {
  const channelId = c.req.param("id");
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canRead(ctx, channelId));
  const db = drizzle(c.env.DB);
  const [chRows, members] = await Promise.all([
    db.select().from(channels).where(eq(channels.id, channelId)).limit(1),
    db.select().from(channelMembers).where(eq(channelMembers.channelId, channelId)),
  ]);
  if (chRows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such channel" } }, 404);
  return c.json({ channel: chRows[0], members });
});

channelsRoutes.patch("/api/v1/channels/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ctx = ctxFor(c);
  // Gate on creator OR server owner — channels.canUpdate is now distinct
  // from canRead (eval Tier A6).
  await requirePolicy(policy.channels.canUpdate(ctx, id));
  const body = await c.req.json() as Partial<{ name: string; description: string | null }>;
  const db = drizzle(c.env.DB);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  await db.update(channels).set(patch).where(eq(channels.id, id));
  return c.json({ ok: true });
});

channelsRoutes.delete("/api/v1/channels/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ctx = ctxFor(c);
  // Same gate as channels.patch — creator OR server owner, with machine-key
  // serverId scoping enforced through policy.channels.canDelete.
  await requirePolicy(policy.channels.canDelete(ctx, id));
  const db = drizzle(c.env.DB);
  await db.delete(channels).where(eq(channels.id, id));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/v1/channels
// ---------------------------------------------------------------------------
channelsRoutes.post("/api/v1/channels", requireAuth, async (c) => {
  const body = createChannelRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  const subject = c.get("subject");
  await requirePolicy(policy.channels.canCreate(ctx, body.serverId));

  const db = drizzle(c.env.DB);

  // VALIDATE initial members + agents are in the same server BEFORE inserting.
  // - initialAgentIds: every agent must live in body.serverId
  //   (without this, a caller could pull a victim's agent from server Y into
  //    a channel of server X — leaks content + opens prompt-injection.)
  // - initialMemberIds: every user must already be a member of body.serverId
  //   (without this, a caller could stuff strangers into private channels
  //    of their workspace, spoofing DM membership in the strangers' sidebars.)
  if (body.initialAgentIds && body.initialAgentIds.length > 0) {
    const agentRows = await db.select({ id: agents.id, serverId: agents.serverId })
      .from(agents).where(inArray(agents.id, body.initialAgentIds));
    if (agentRows.length !== body.initialAgentIds.length) {
      return c.json({ error: { code: "BAD_REQ", message: "one or more initialAgentIds not found" } }, 400);
    }
    if (agentRows.some(r => r.serverId !== body.serverId)) {
      return c.json({ error: { code: "BAD_REQ", message: "agents must belong to the same server" } }, 400);
    }
  }
  if (body.initialMemberIds && body.initialMemberIds.length > 0) {
    const memberRows = await db.select({ memberId: serverMembers.memberId })
      .from(serverMembers).where(and(
        eq(serverMembers.serverId, body.serverId),
        inArray(serverMembers.memberId, body.initialMemberIds),
        eq(serverMembers.memberType, "human"),
      ));
    if (memberRows.length !== body.initialMemberIds.length) {
      return c.json({ error: { code: "BAD_REQ", message: "one or more initialMemberIds are not server members" } }, 400);
    }
  }

  const id = crypto.randomUUID();
  const now = new Date();
  await db.batch([
    db.insert(channels).values({
      id, serverId: body.serverId, name: body.name,
      description: body.description ?? null, type: body.type,
      createdBy: subject.userId, createdAt: now,
    }),
    db.insert(channelMembers).values([
      { channelId: id, memberId: subject.userId, memberType: "human", joinedAt: now },
      ...((body.initialMemberIds ?? []).map(uid =>
        ({ channelId: id, memberId: uid, memberType: "human" as const, joinedAt: now }))),
      ...((body.initialAgentIds ?? []).map(aid =>
        ({ channelId: id, memberId: aid, memberType: "agent" as const, joinedAt: now }))),
    ]),
  ]);

  // Notify each affected user's UserGateway DO so live bridges/web tabs can
  // pick up the new channel without waiting for the next token refresh.
  const userIdsToNotify = new Set<string>([subject.userId, ...(body.initialMemberIds ?? [])]);
  // Each agent's owner also needs to know.
  if (body.initialAgentIds && body.initialAgentIds.length > 0) {
    const agentRows = await db.select({ ownerId: agents.ownerId }).from(agents)
      .where(inArray(agents.id, body.initialAgentIds));
    for (const r of agentRows) userIdsToNotify.add(r.ownerId);
  }
  await Promise.all([...userIdsToNotify].map(uid =>
    notifyGateway(c.env, uid, {
      v: 1, t: "member_add", channelId: id, memberId: uid, memberType: "human" as const,
    }),
  ));

  return c.json({ id });
});

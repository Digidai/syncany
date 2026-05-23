import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@raltic/auth-core";
import { listMessagesQuery, createChannelRequest, markReadRequest } from "@raltic/protocol";
import { servers, serverMembers, agents, channels, channelMembers, messages, reactions, user } from "@raltic/db";
import { and, desc, eq, lt, inArray, sql as sqlFn } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, requireUser, ctxFor } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { notifyGateway } from "../lib/notify";
import { z } from "zod";

// Validated patch payload — replaces an unsafe `as Partial<{...}>` cast.
const updateChannelBody = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(1000).nullable().optional(),
});

// POST /api/v1/dm — find-or-create a 1:1 DM channel.
// Body shape kept inline (small, not shared with other clients yet).
const openDmBody = z.object({
  serverId: z.string().min(1).max(128),
  peerType: z.enum(["human", "agent"]),
  peerId: z.string().min(1).max(128),
});

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
  const subject = c.get("subject");
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canRead(ctx, channelId));
  const db = drizzle(c.env.DB);
  const [chRows, members] = await Promise.all([
    db.select().from(channels).where(eq(channels.id, channelId)).limit(1),
    db.select().from(channelMembers).where(eq(channelMembers.channelId, channelId)),
  ]);
  if (chRows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such channel" } }, 404);
  const channel = chRows[0];

  // DM peer resolution — same shape as /servers/by-slug returns per
  // channel. The message-area header uses this to render the OTHER
  // party's name in the DM title bar.
  let peer: {
    name: string;
    type: "human" | "agent";
    id: string;
    avatarSeed?: string | null;
    runtime?: "claude" | "codex" | "openclaw" | "hermes" | null;
  } | null = null;
  if (channel.type === "dm") {
    const other = members.find(m => !(m.memberType === "human" && m.memberId === subject.userId));
    if (other) {
      if (other.memberType === "human") {
        const r = await db.select({ name: user.name }).from(user).where(eq(user.id, other.memberId)).limit(1);
        if (r[0]) peer = { name: r[0].name, type: "human", id: other.memberId };
      } else {
        const r = await db.select({
          displayName: agents.displayName, avatarSeed: agents.avatarSeed, runtime: agents.runtime,
        }).from(agents).where(eq(agents.id, other.memberId)).limit(1);
        if (r[0]) peer = {
          name: r[0].displayName, type: "agent", id: other.memberId,
          avatarSeed: r[0].avatarSeed,
          // agents.runtime is plain TEXT (S2) — cast to the narrow
          // peer type. Legacy gemini/copilot rows will surface here
          // verbatim; the UI's RuntimeChip falls through to a generic
          // tone for unknown ids.
          runtime: r[0].runtime as "claude" | "codex" | "openclaw" | "hermes" | null,
        };
      }
    }
  }
  return c.json({ channel, members, peer });
});

// ---------------------------------------------------------------------------
// GET /api/v1/servers/:serverId/channels/browse — public-channel directory
//
// Browse all public channels in the workspace, with an `isMember` flag
// per row so the UI can render a Join button only for non-member rows.
// New users invited to a workspace can't see channels they haven't been
// added to in the sidebar, so without this surface they have no way to
// discover the workspace's #general / #design / etc.
// ---------------------------------------------------------------------------
channelsRoutes.get("/api/v1/servers/:serverId/channels/browse", requireAuth, async (c) => {
  const serverId = c.req.param("serverId");
  const subject = c.get("subject");
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canRead(ctx, serverId));
  const db = drizzle(c.env.DB);
  // Only public — private channels are member-only by design, no
  // discovery surface for those.
  const rows = await db
    .select({
      id: channels.id, name: channels.name, description: channels.description,
      createdAt: channels.createdAt,
    })
    .from(channels)
    .where(and(eq(channels.serverId, serverId), eq(channels.type, "public")));
  const myMemberships = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(and(
      eq(channelMembers.memberId, subject.userId),
      eq(channelMembers.memberType, "human"),
      inArray(channelMembers.channelId, rows.map((r) => r.id)),
    ));
  const memberSet = new Set(myMemberships.map((m) => m.channelId));
  return c.json({
    channels: rows.map((r) => ({
      ...r,
      isMember: memberSet.has(r.id),
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/channels/:id/join — opt-in for public channels
//
// Public channels are visible in the browse surface but the user only
// gets them in their sidebar after explicitly joining. Private channels
// can't be self-joined (admin/owner has to add). Self-join for already-
// joined channels is a no-op (200).
// ---------------------------------------------------------------------------
channelsRoutes.post("/api/v1/channels/:id/join", requireAuth, requireUser, async (c) => {
  const channelId = c.req.param("id");
  const subject = c.get("subject");
  // 30/hr/user — bursty join (e.g. browsing the directory + clicking
  // through several rows in a session) but not abuse-shaped.
  const limited = await rateLimit(c, "channel_join", subject.userId, 30, 3600);
  if (limited) return limited;
  const db = drizzle(c.env.DB);

  const rows = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such channel" } }, 404);
  const ch = rows[0];
  if (ch.type !== "public") {
    return c.json({ error: { code: "FORBIDDEN", message: "channel is not joinable" } }, 403);
  }
  // Verify the user is a member of the channel's workspace — joining a
  // channel in a workspace you don't belong to would let any signed-in
  // user enumerate channel IDs across the platform.
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canRead(ctx, ch.serverId));

  // Already a member? Return ok without re-inserting (PK collision).
  const existing = await db.select({ channelId: channelMembers.channelId }).from(channelMembers)
    .where(and(
      eq(channelMembers.channelId, channelId),
      eq(channelMembers.memberId, subject.userId),
      eq(channelMembers.memberType, "human"),
    )).limit(1);
  if (existing.length > 0) {
    return c.json({ ok: true, alreadyMember: true });
  }
  await db.insert(channelMembers).values({
    channelId, memberId: subject.userId, memberType: "human", joinedAt: new Date(),
  });
  // Notify gateway so the user's sidebar picks up the new channel
  // without waiting for a refresh.
  void notifyGateway(c.env, subject.userId, {
    v: 1, t: "member_add", channelId, memberId: subject.userId, memberType: "human" as const,
  }).catch(() => { /* swallow — channel still appears on next refresh */ });
  return c.json({ ok: true, alreadyMember: false });
});

channelsRoutes.patch("/api/v1/channels/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ctx = ctxFor(c);
  // Gate on creator OR server owner — channels.canUpdate is now distinct
  // from canRead (eval Tier A6).
  await requirePolicy(policy.channels.canUpdate(ctx, id));
  const body = updateChannelBody.parse(await c.req.json());
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
  const subject = c.get("subject");
  // 30/hour/user — onboarding burst-friendly, prevents a compromised
  // session from spamming channel names to fill the sidebar.
  const limited = await rateLimit(c, "channel_create", subject.userId, 30, 3600);
  if (limited) return limited;
  const body = createChannelRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canCreate(ctx, body.serverId));
  // Workspace cap — prevents collective sidebar-spam in shared workspaces.
  const wsLimited = await rateLimit(c, "channel_create_ws", body.serverId, 150, 3600);
  if (wsLimited) return wsLimited;

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
  // allSettled — a notification fan-out failure shouldn't turn a
  // successful channel-create into a 500. Members will see the channel
  // on their next sidebar refresh anyway.
  const results = await Promise.allSettled([...userIdsToNotify].map(uid =>
    notifyGateway(c.env, uid, {
      v: 1, t: "member_add", channelId: id, memberId: uid, memberType: "human" as const,
    }),
  ));
  for (const r of results) {
    if (r.status === "rejected") {
      console.error(JSON.stringify({
        ts: new Date().toISOString(), level: "warn",
        msg: "channel.create.notify_failed", channelId: id,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      }));
    }
  }

  return c.json({ id });
});

// ---------------------------------------------------------------------------
// POST /api/v1/dm — find-or-create 1:1 DM channel
//
// The schema has always supported human↔human DMs (channels.type='dm' +
// channel_members rows where memberType can be 'human' or 'agent'), but
// only agent DMs were ever auto-created by runOnboarding + agents.ts.
// Invited users had no in-product way to message each other; they could
// only mention each other in public channels. This endpoint closes that
// gap by lazily creating the DM channel on first open.
//
// Find-or-create semantics (idempotent):
//   - SELECT existing dm with EXACTLY (me, peer) as the two members
//     (no third party, otherwise we'd return a group DM).
//   - If none, INSERT one + 2 channel_members rows in a batch.
// ---------------------------------------------------------------------------
channelsRoutes.post("/api/v1/dm", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  // Machine keys can already see DM channels they own via the bridge
  // boot payload, but they should never *create* user-facing DMs —
  // that surface is human-session only (gated by requireUser above).
  const body = openDmBody.parse(await c.req.json());

  // Disallow self-DM. Slack/Discord allow "messages to yourself" as a
  // notes surface but we don't want to ship a half-baked version of
  // that; keep the slot open for an explicit "Saved messages" feature.
  if (body.peerType === "human" && body.peerId === subject.userId) {
    return c.json({ error: { code: "INVALID", message: "cannot DM yourself" } }, 400);
  }

  // 100/hour/user — DM creation should be rare in normal use; this cap
  // catches a leaky picker firing repeated open requests.
  const limited = await rateLimit(c, "dm_open", subject.userId, 100, 3600);
  if (limited) return limited;

  const ctx = ctxFor(c);
  // Caller must be a member of the workspace. canRead doubles as a
  // membership probe; it also covers the "server doesn't exist" case
  // by 404'ing instead of leaking existence.
  await requirePolicy(policy.servers.canRead(ctx, body.serverId));

  const db = drizzle(c.env.DB);

  // Verify the peer is part of the same workspace — prevents using
  // the endpoint to enumerate user/agent ids across workspaces.
  if (body.peerType === "human") {
    const peerRow = await db.select({ id: serverMembers.serverId })
      .from(serverMembers)
      .where(and(
        eq(serverMembers.serverId, body.serverId),
        eq(serverMembers.memberId, body.peerId),
        eq(serverMembers.memberType, "human"),
      )).limit(1);
    if (peerRow.length === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "peer not in this workspace" } }, 404);
    }
  } else {
    const peerAgent = await db.select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, body.peerId), eq(agents.serverId, body.serverId)))
      .limit(1);
    if (peerAgent.length === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "agent not in this workspace" } }, 404);
    }
  }

  // Find existing DM containing EXACTLY (me, peer). The query: list
  // all dm channels in this workspace where the caller is a member,
  // then for each check whether the peer is also a member AND the
  // total member count is 2. Done in SQL with two joins + GROUP BY to
  // stay race-safe under concurrent member edits.
  //
  // We can't reasonably uniqueness-index "the set of members" in
  // SQLite without a derived column; the GROUP BY HAVING count=2
  // approach is the standard SQL idiom for "pairwise channel" lookup.
  //
  // ORDER BY (created_at, id) is the same deterministic ranking the
  // post-insert reconciliation uses below — every caller agrees on the
  // keeper. Selecting ALL matches (not LIMIT 1) lets us also clean up
  // stale duplicates from a prior failed race on the read path.
  const findPair = async () => c.env.DB.prepare(`
    SELECT c.id AS id, c.created_at AS createdAt
      FROM channels c
      JOIN channel_members me   ON me.channel_id   = c.id AND me.member_id   = ?1 AND me.member_type   = 'human'
      JOIN channel_members peer ON peer.channel_id = c.id AND peer.member_id = ?2 AND peer.member_type = ?3
      JOIN channel_members all_m ON all_m.channel_id = c.id
     WHERE c.type = 'dm'
       AND c.server_id = ?4
     GROUP BY c.id
    HAVING COUNT(all_m.channel_id) = 2
     ORDER BY c.created_at ASC, c.id ASC
  `).bind(subject.userId, body.peerId, body.peerType, body.serverId).all<{ id: string; createdAt: number }>();

  const pruneLosers = async (rows: Array<{ id: string }>): Promise<string> => {
    const keeperId = rows[0].id;
    for (const dup of rows.slice(1)) {
      await db.delete(channels).where(eq(channels.id, dup.id));
    }
    return keeperId;
  };

  const before = (await findPair()).results ?? [];
  if (before.length >= 1) {
    // Found one or more existing DMs for this pair — return the keeper,
    // prune any stragglers from prior failed races on the way out.
    const keeperId = await pruneLosers(before);
    return c.json({ channelId: keeperId, created: false });
  }

  // No existing pair → create one. Channel name is the peer's display
  // identifier for sidebar/header display; for human↔human DMs the UI
  // resolves it to the OTHER party's name anyway, so the stored value
  // is mostly cosmetic.
  const channelId = crypto.randomUUID();
  const now = new Date();
  // channel.name is mostly cosmetic for DMs — the sidebar + header
  // render the OTHER party's name via channel.peer (resolved in
  // /servers/by-slug and /channels/:id; see B4 work). Storing the
  // peer's real name here is still nice for any consumer that hasn't
  // adopted channel.peer yet (legacy clients, future API consumers,
  // logs/audits). Falls back to an id slug if the lookup misses.
  let peerName = "dm";
  if (body.peerType === "human") {
    const p = await db.select({ name: user.name }).from(user)
      .where(eq(user.id, body.peerId)).limit(1);
    peerName = p[0]?.name ?? `user-${body.peerId.slice(0, 8)}`;
  } else {
    const p = await db.select({ displayName: agents.displayName }).from(agents)
      .where(eq(agents.id, body.peerId)).limit(1);
    peerName = p[0]?.displayName ?? `agent-${body.peerId.slice(0, 8)}`;
  }

  await db.batch([
    db.insert(channels).values({
      id: channelId,
      serverId: body.serverId,
      name: peerName,
      type: "dm",
      createdBy: subject.userId,
      createdAt: now,
    }),
    db.insert(channelMembers).values([
      { channelId, memberId: subject.userId, memberType: "human", joinedAt: now },
      { channelId, memberId: body.peerId, memberType: body.peerType, joinedAt: now },
    ]),
  ]);

  // Loser-deletes race resolution — D1 has no transaction primitive that
  // spans the SELECT-then-INSERT above, so two concurrent openDm calls
  // for the same (me, peer) can each see no existing row and both create
  // a channel. After our INSERT we re-run the pairwise lookup; if more
  // than one DM exists, every concurrent caller deterministically agrees
  // on the keeper (oldest createdAt, then lexicographic id tiebreak) and
  // every racer prunes everything past the keeper. The FK cascade on
  // channel_members cleans the orphaned membership rows when we drop a
  // channel.
  const after = (await findPair()).results ?? [];
  const keeperId = after.length > 0 ? await pruneLosers(after) : channelId;

  // Best-effort gateway notification so the peer's web tab + bridge
  // (if they're an agent owner) see the new channel immediately.
  void notifyGateway(c.env, body.peerType === "human" ? body.peerId : subject.userId, {
    v: 1, t: "member_add", channelId: keeperId, memberId: subject.userId, memberType: "human" as const,
  }).catch(() => { /* swallow — channel still exists on next refresh */ });

  return c.json({ channelId: keeperId, created: keeperId === channelId });
});

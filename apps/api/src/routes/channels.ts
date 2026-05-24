import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@raltic/auth-core";
import { listMessagesQuery, createChannelRequest, markReadRequest, addChannelMembersRequest } from "@raltic/protocol";
import { servers, serverMembers, agents, channels, channelMembers, messages, reactions, user } from "@raltic/db";
import { and, desc, eq, lt, inArray, sql as sqlFn } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, requireUser, ctxFor } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { notifyGateway, kickFromChannel, kickNonMembers } from "../lib/notify";
import { z } from "zod";

// Validated patch payload — replaces an unsafe `as Partial<{...}>` cast.
const updateChannelBody = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(1000).nullable().optional(),
  // Phase B: topic = current focus (separate from description).
  // Max 250 — Slack-style one-liner, not a paragraph.
  topic: z.string().max(250).nullable().optional(),
});

// Phase B: PATCH /api/v1/channels/:id/visibility — public ↔ private.
const updateVisibilityBody = z.object({
  type: z.enum(["public", "private"]),
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
  // viewerCanManage = same gate as PATCH/DELETE (channel creator OR
  // workspace owner). UI uses it to show Rename/Delete/Remove-other.
  // viewerCanAddMembers = any current member can add (matches
  // policy.channels.canAddMember). Split into two flags after codex
  // C5 MED — earlier UI conflated them and under-exposed Add for
  // non-creator members.
  const [viewerCanManage, viewerCanAddMembers, viewerMembership] = await Promise.all([
    policy.channels.canUpdate(ctx, channelId),
    policy.channels.canAddMember(ctx, channelId),
    // Viewer-specific mutedAt + starredAt (Phase A/E): the bare channels
    // row doesn't carry per-user state. Pull both in one query so
    // ChannelActions can render Mute/Unmute + Star/Unstar correctly.
    db.select({
      mutedAt: channelMembers.mutedAt,
      starredAt: channelMembers.starredAt,
    })
      .from(channelMembers).where(and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.memberId, subject.userId),
        eq(channelMembers.memberType, "human"),
      )).limit(1),
  ]);
  // Surface as ms timestamps so the wire shape matches what the sidebar
  // already gets from /servers/by-slug.
  const viewerMutedAt = viewerMembership[0]?.mutedAt instanceof Date
    ? viewerMembership[0].mutedAt.getTime()
    : (viewerMembership[0]?.mutedAt ?? null);
  const viewerStarredAt = viewerMembership[0]?.starredAt instanceof Date
    ? viewerMembership[0].starredAt.getTime()
    : (viewerMembership[0]?.starredAt ?? null);

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
  // Codex G1 MED 3 — scrub members payload so we don't leak every
  // peer's mutedAt/starredAt/lastReadSeq via `select *`. Those columns
  // are per-user preferences that the viewer has no business seeing
  // for other members. Only id/type/joinedAt are returned.
  const safeMembers = members.map((m) => ({
    channelId: m.channelId,
    memberId: m.memberId,
    memberType: m.memberType,
    joinedAt: m.joinedAt,
  }));
  return c.json({
    // Channel base record + viewer's mute flag (Phase A codex PA3 HIGH
    // fix). Spreading lets the web client just read channel.mutedAt
    // without a separate field — the sidebar already does this via
    // getServerBySlug, keeping the two shapes aligned.
    channel: { ...channel, mutedAt: viewerMutedAt, starredAt: viewerStarredAt },
    members: safeMembers, peer, viewerCanManage, viewerCanAddMembers,
  });
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
  if (body.topic !== undefined) patch.topic = body.topic;
  await db.update(channels).set(patch).where(eq(channels.id, id));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/channels/:id/visibility — public ↔ private convert
//
// Same gate as rename (canUpdate = creator/owner). Trying to convert a
// DM is a no-op error — DMs are pairwise by definition.
//
// SECURITY: Converting public→private does NOT change membership. The
// existing public-channel members keep access. Owners who want a true
// "fresh start" should create a new private channel and pull in only
// the desired members. We surface this expectation in the UI confirm
// dialog.
// ---------------------------------------------------------------------------
channelsRoutes.patch("/api/v1/channels/:id/visibility", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  const limited = await rateLimit(c, "channel_visibility", subject.userId, 10, 3600);
  if (limited) return limited;
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canUpdate(ctx, id));
  const body = updateVisibilityBody.parse(await c.req.json());
  const db = drizzle(c.env.DB);
  const rows = await db.select({ type: channels.type }).from(channels)
    .where(eq(channels.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such channel" } }, 404);
  if (rows[0].type === "dm") {
    return c.json({ error: { code: "BAD_REQ", message: "cannot change visibility of a DM" } }, 400);
  }
  if (rows[0].type === body.type) {
    return c.json({ ok: true, unchanged: true });
  }
  await db.update(channels).set({ type: body.type }).where(eq(channels.id, id));
  // Codex G1 HIGH 2 — when converting public → private, drop any WS
  // sessions held by users who are NOT current channel members.
  // Without this, prior workspace-strangers who happened to have the
  // channel open keep receiving the newly-private broadcasts.
  if (body.type === "private") {
    const [humanMembers, agentMembers] = await Promise.all([
      db.select({ memberId: channelMembers.memberId })
        .from(channelMembers).where(and(
          eq(channelMembers.channelId, id),
          eq(channelMembers.memberType, "human"),
        )),
      db.select({ memberId: channelMembers.memberId })
        .from(channelMembers).where(and(
          eq(channelMembers.channelId, id),
          eq(channelMembers.memberType, "agent"),
        )),
    ]);
    void kickNonMembers(
      c.env, id,
      humanMembers.map((r) => r.memberId),
      agentMembers.map((r) => r.memberId),
    ).catch(() => { /* swallow — best-effort */ });
  }
  return c.json({ ok: true, type: body.type });
});

// ---------------------------------------------------------------------------
// POST /api/v1/channels/:id/archive  +  POST /unarchive — soft-delete
//
// Archived channels are read-only AND hidden from the sidebar by
// default. Existing messages are preserved (no data loss); a banner
// in the channel header explains the state + offers Unarchive. Same
// gate as delete (canUpdate). DMs can't be archived — leave handles
// that surface for DMs.
// ---------------------------------------------------------------------------
channelsRoutes.post("/api/v1/channels/:id/archive", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  const limited = await rateLimit(c, "channel_archive", subject.userId, 20, 3600);
  if (limited) return limited;
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canUpdate(ctx, id));
  const db = drizzle(c.env.DB);
  const rows = await db.select({ type: channels.type, archivedAt: channels.archivedAt }).from(channels)
    .where(eq(channels.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such channel" } }, 404);
  if (rows[0].type === "dm") {
    return c.json({ error: { code: "BAD_REQ", message: "cannot archive a DM" } }, 400);
  }
  if (rows[0].archivedAt != null) {
    return c.json({ ok: true, alreadyArchived: true });
  }
  await db.update(channels).set({ archivedAt: new Date(), archivedBy: subject.userId })
    .where(eq(channels.id, id));
  return c.json({ ok: true });
});

channelsRoutes.post("/api/v1/channels/:id/unarchive", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  const limited = await rateLimit(c, "channel_unarchive", subject.userId, 20, 3600);
  if (limited) return limited;
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canUpdate(ctx, id));
  const db = drizzle(c.env.DB);
  const rows = await db.select({ archivedAt: channels.archivedAt }).from(channels)
    .where(eq(channels.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such channel" } }, 404);
  if (rows[0].archivedAt == null) {
    return c.json({ ok: true, alreadyActive: true });
  }
  await db.update(channels).set({ archivedAt: null, archivedBy: null })
    .where(eq(channels.id, id));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/v1/channels/:id/members — add humans + agents to a channel
//
// Authorization: caller must be a member of the channel (policy.canAddMember).
// For private channels this enforces the invariant that only insiders can
// pull more people in. For DMs we 400 — DMs are pairwise by definition.
//
// All new members must belong to the channel's server (validated here,
// not just at create-time, since this is a separate codepath).
//
// Idempotent: already-member ids are silently skipped. Result reports
// `added` + `skipped` so the UI can show "Added 3 (2 already in channel)".
// ---------------------------------------------------------------------------
channelsRoutes.post("/api/v1/channels/:id/members", requireAuth, requireUser, async (c) => {
  const channelId = c.req.param("id");
  const subject = c.get("subject");
  // 60/hr/user — bulk-add usually one batch per channel; this cap catches a
  // misbehaving picker firing on every keystroke.
  const limited = await rateLimit(c, "channel_add_member", subject.userId, 60, 3600);
  if (limited) return limited;
  const body = addChannelMembersRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canAddMember(ctx, channelId));

  const db = drizzle(c.env.DB);
  const chRows = await db.select({ serverId: channels.serverId, type: channels.type })
    .from(channels).where(eq(channels.id, channelId)).limit(1);
  if (chRows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such channel" } }, 404);
  const ch = chRows[0];
  if (ch.type === "dm") {
    return c.json({ error: { code: "BAD_REQ", message: "cannot add members to a DM" } }, 400);
  }

  // Dedupe each list — protect against a misbehaving client and against
  // the cross-type PK collision codex M3 flagged (channel_members PK is
  // (channel_id, member_id) WITHOUT member_type, so the same id can't be
  // both a human and an agent in the same channel). If a caller sends
  // an id in BOTH lists we drop it from the agent list — human wins.
  const reqMemberIds = Array.from(new Set(body.memberIds ?? []));
  const reqAgentIds = Array.from(new Set(body.agentIds ?? []))
    .filter((id) => !reqMemberIds.includes(id));

  // Validate every human is in the same workspace — otherwise a caller
  // could shove strangers into private channels of their workspace.
  if (reqMemberIds.length > 0) {
    const rows = await db.select({ memberId: serverMembers.memberId })
      .from(serverMembers).where(and(
        eq(serverMembers.serverId, ch.serverId),
        inArray(serverMembers.memberId, reqMemberIds),
        eq(serverMembers.memberType, "human"),
      ));
    if (rows.length !== reqMemberIds.length) {
      return c.json({ error: { code: "BAD_REQ", message: "one or more memberIds are not workspace members" } }, 400);
    }
  }
  if (reqAgentIds.length > 0) {
    const rows = await db.select({ id: agents.id, serverId: agents.serverId })
      .from(agents).where(inArray(agents.id, reqAgentIds));
    if (rows.length !== reqAgentIds.length) {
      return c.json({ error: { code: "BAD_REQ", message: "one or more agentIds not found" } }, 400);
    }
    if (rows.some((r) => r.serverId !== ch.serverId)) {
      return c.json({ error: { code: "BAD_REQ", message: "agents must belong to the same workspace" } }, 400);
    }
  }

  // Find existing membership so we can dedupe + report skipped count.
  const allIds = [...reqMemberIds, ...reqAgentIds];
  const existing = allIds.length === 0 ? [] : await db
    .select({ memberId: channelMembers.memberId, memberType: channelMembers.memberType })
    .from(channelMembers)
    .where(and(
      eq(channelMembers.channelId, channelId),
      inArray(channelMembers.memberId, allIds),
    ));
  const existingHuman = new Set(existing.filter(r => r.memberType === "human").map(r => r.memberId));
  const existingAgent = new Set(existing.filter(r => r.memberType === "agent").map(r => r.memberId));

  const newHumans = reqMemberIds.filter((id) => !existingHuman.has(id));
  const newAgents = reqAgentIds.filter((id) => !existingAgent.has(id));

  const now = new Date();
  if (newHumans.length + newAgents.length > 0) {
    await db.insert(channelMembers).values([
      ...newHumans.map((memberId) => ({ channelId, memberId, memberType: "human" as const, joinedAt: now })),
      ...newAgents.map((memberId) => ({ channelId, memberId, memberType: "agent" as const, joinedAt: now })),
    ]);
  }

  // Real-time fanout, per-recipient + per-event-type.
  //
  // Codex C2 HIGH: previous version always sent {memberType: "human",
  // memberId: <recipientUserId>} even when the actual event was an
  // agent join. The bridge listens to member_add to update its
  // channel→agent map (packages/bridge-core/src/agent-manager.ts) and
  // never sees the new agent if we mislabel it as a human-self-join,
  // so the agent stays silent in the channel until the bridge reconnects.
  //
  // Build one notification per (recipient, event) pair: a human gets
  // an add for themselves; an agent's owner gets an add for the agent.
  type Notify = { userId: string; ev: { v: 1; t: "member_add"; channelId: string; memberId: string; memberType: "human" | "agent" } };
  const notifs: Notify[] = newHumans.map((h) => ({
    userId: h,
    ev: { v: 1, t: "member_add", channelId, memberId: h, memberType: "human" },
  }));
  if (newAgents.length > 0) {
    const ownerRows = await db.select({ id: agents.id, ownerId: agents.ownerId }).from(agents)
      .where(inArray(agents.id, newAgents));
    for (const r of ownerRows) {
      notifs.push({
        userId: r.ownerId,
        ev: { v: 1, t: "member_add", channelId, memberId: r.id, memberType: "agent" },
      });
    }
  }
  // Also notify the initiator so their OTHER tabs/devices pick up the
  // change. Skip if they're already in `notifs` as a freshly-added human
  // (which would only happen if the caller added themselves, currently
  // impossible since canAddMember requires caller is already a member).
  if (!notifs.some((n) => n.userId === subject.userId)) {
    // No payload "you were added" — use a self-targeted member_add that
    // re-affirms membership. Web handler treats it as a sidebar refresh
    // trigger. Cheaper than inventing a new "roster_changed" event.
    notifs.push({
      userId: subject.userId,
      ev: { v: 1, t: "member_add", channelId, memberId: subject.userId, memberType: "human" },
    });
  }
  const results = await Promise.allSettled(notifs.map((n) =>
    notifyGateway(c.env, n.userId, n.ev),
  ));
  for (const r of results) {
    if (r.status === "rejected") {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(), level: "warn",
        msg: "channel.add_member.notify_failed", channelId,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      }));
    }
  }

  return c.json({
    ok: true,
    added: { humans: newHumans.length, agents: newAgents.length },
    skipped: { humans: reqMemberIds.length - newHumans.length, agents: reqAgentIds.length - newAgents.length },
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/channels/:id/members/:type/:memberId — remove ONE member
//
// `:type` = "human" | "agent". Tighter gate than add: only channel creator
// OR server owner (canRemoveMember). Self-removal goes through POST /leave
// to keep the intent obvious in audit logs + so the rate limit + policy gate
// can differ in the future (e.g. block "last admin" leaves without blocking
// owner-driven removals).
// ---------------------------------------------------------------------------
channelsRoutes.delete("/api/v1/channels/:id/members/:type/:memberId", requireAuth, requireUser, async (c) => {
  const channelId = c.req.param("id");
  const memberType = c.req.param("type");
  const memberId = c.req.param("memberId");
  if (memberType !== "human" && memberType !== "agent") {
    return c.json({ error: { code: "BAD_REQ", message: "type must be human or agent" } }, 400);
  }
  const subject = c.get("subject");
  const limited = await rateLimit(c, "channel_remove_member", subject.userId, 60, 3600);
  if (limited) return limited;

  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canRemoveMember(ctx, channelId));

  const db = drizzle(c.env.DB);
  const chRows = await db.select({ type: channels.type }).from(channels)
    .where(eq(channels.id, channelId)).limit(1);
  if (chRows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such channel" } }, 404);
  if (chRows[0].type === "dm") {
    return c.json({ error: { code: "BAD_REQ", message: "cannot remove members from a DM" } }, 400);
  }
  // Block self-remove on this endpoint — force /leave so intent is clear.
  if (memberType === "human" && memberId === subject.userId) {
    return c.json({ error: { code: "BAD_REQ", message: "use POST /leave to remove yourself" } }, 400);
  }

  // Codex C2 MED: precheck membership BEFORE delete so we don't fan out
  // a notify (or do a cross-workspace agent owner lookup) for a no-op
  // call. Idempotent semantics: not-a-member → 200 alreadyRemoved=true.
  const existing = await db.select({ memberId: channelMembers.memberId })
    .from(channelMembers).where(and(
      eq(channelMembers.channelId, channelId),
      eq(channelMembers.memberId, memberId),
      eq(channelMembers.memberType, memberType as "human" | "agent"),
    )).limit(1);
  if (existing.length === 0) {
    return c.json({ ok: true, alreadyRemoved: true });
  }

  await db.delete(channelMembers).where(and(
    eq(channelMembers.channelId, channelId),
    eq(channelMembers.memberId, memberId),
    eq(channelMembers.memberType, memberType as "human" | "agent"),
  ));

  // SECURITY TODO (codex C2/C4/C5 HIGH): we delete the D1 row + emit
  // member_remove via UserGateway, but ChatRoom DO keeps any open
  // channel WS bound to this user/agent and continues broadcasting.
  // Until ChatRoom learns to drop sockets on membership change, a
  // removed user with an open tab keeps receiving messages until
  // reload. Bridge tokens are 7-day signed and channel-scoped; same
  // window. See docs/SECURITY_TODO_channel_member_kick.md (todo).
  //
  // Mitigation in scope: server already refuses sends/typing/history
  // from non-members (chat-room.ts canPost/canRead checks per RPC),
  // so the removed party can only PASSIVELY receive — not post.

  // Notify the removed party so their sidebar drops the channel live.
  // Send with the actual removed memberId+memberType so the receiving
  // UserGateway / bridge can identify what to drop.
  let notifyTargetUserId: string | null = null;
  if (memberType === "human") {
    notifyTargetUserId = memberId;
  } else {
    // Scope agent lookup to the channel's workspace — defense-in-depth
    // against a future bug where canRemoveMember passes incorrectly.
    const chRow = await db.select({ serverId: channels.serverId }).from(channels)
      .where(eq(channels.id, channelId)).limit(1);
    if (chRow[0]) {
      const owner = await db.select({ ownerId: agents.ownerId }).from(agents)
        .where(and(eq(agents.id, memberId), eq(agents.serverId, chRow[0].serverId))).limit(1);
      if (owner[0]) notifyTargetUserId = owner[0].ownerId;
    }
  }
  if (notifyTargetUserId) {
    void notifyGateway(c.env, notifyTargetUserId, {
      v: 1, t: "member_remove", channelId, memberId, memberType: memberType as "human" | "agent",
    }).catch(() => { /* swallow — sidebar refreshes on next nav */ });
  }
  // Phase D — drop the removed party's live ChatRoom WS so they
  // stop receiving broadcasts immediately (codex C2/C4/C5 HIGH).
  // Best-effort: fanout miss must not 500 the successful delete.
  void kickFromChannel(c.env, channelId, memberId, memberType as "human" | "agent")
    .catch(() => { /* swallow — passive receive window closes on reload at worst */ });

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/v1/channels/:id/leave — self-exit a channel
//
// Anyone in the channel can leave. No "last admin" lock — abandoned
// channels can be cleaned up by the server owner via DELETE. DMs can't
// be left (they're the entire conversation; use server-level
// settings/people page to mute or block instead).
// ---------------------------------------------------------------------------
channelsRoutes.post("/api/v1/channels/:id/leave", requireAuth, requireUser, async (c) => {
  const channelId = c.req.param("id");
  const subject = c.get("subject");
  const limited = await rateLimit(c, "channel_leave", subject.userId, 30, 3600);
  if (limited) return limited;

  const db = drizzle(c.env.DB);
  const chRows = await db.select({ type: channels.type }).from(channels)
    .where(eq(channels.id, channelId)).limit(1);
  if (chRows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such channel" } }, 404);
  if (chRows[0].type === "dm") {
    return c.json({ error: { code: "BAD_REQ", message: "cannot leave a DM" } }, 400);
  }

  // Idempotency (codex C2 MED): don't require policy.canLeave gate to
  // pass for "already left" — a second click after sidebar removal
  // races a stale tab. Pre-check membership and return alreadyLeft=true
  // when there's nothing to delete. Real auth still needed for FIRST leave.
  const existing = await db.select({ memberId: channelMembers.memberId })
    .from(channelMembers).where(and(
      eq(channelMembers.channelId, channelId),
      eq(channelMembers.memberId, subject.userId),
      eq(channelMembers.memberType, "human"),
    )).limit(1);
  if (existing.length === 0) {
    return c.json({ ok: true, alreadyLeft: true });
  }
  // Now run the actual auth gate — channel + workspace scoping.
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canLeave(ctx, channelId));

  await db.delete(channelMembers).where(and(
    eq(channelMembers.channelId, channelId),
    eq(channelMembers.memberId, subject.userId),
    eq(channelMembers.memberType, "human"),
  ));

  // Notify own UserGateway so this user's other tabs drop the channel
  // from their sidebar live (the tab that initiated the leave already
  // mutates locally; this catches multi-tab users).
  void notifyGateway(c.env, subject.userId, {
    v: 1, t: "member_remove", channelId, memberId: subject.userId, memberType: "human" as const,
  }).catch(() => { /* swallow — sidebar refreshes on next nav */ });
  // Phase D — drop this user's WS sessions from the channel DO so
  // they stop receiving broadcasts even if they have stale tabs.
  void kickFromChannel(c.env, channelId, subject.userId, "human")
    .catch(() => { /* swallow */ });

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/v1/channels/:id/mute  +  DELETE same — per-user channel mute
//
// Mute is per-channel-member, not per-channel. Other members of the
// same channel aren't affected. Sidebar still shows the channel but
// suppresses the unread badge + bold weight so noisy channels (e.g.
// 5 agents chatting) don't dominate. DMs are mute-able too (a
// runaway agent DM is the canonical "noisy" case).
//
// Idempotent: re-muting a muted channel just refreshes muted_at.
// ---------------------------------------------------------------------------
channelsRoutes.post("/api/v1/channels/:id/mute", requireAuth, requireUser, async (c) => {
  const channelId = c.req.param("id");
  const subject = c.get("subject");
  const limited = await rateLimit(c, "channel_mute", subject.userId, 60, 3600);
  if (limited) return limited;
  const ctx = ctxFor(c);
  // Mute is per-user-as-human; we must NOT accept the canLeave gate
  // here because it also admits agent owners (who don't have a human
  // membership row to flip). Inline check + 404 if the user isn't a
  // human member — keeps the silent-no-op codex PA1 MED from
  // returning a misleading 200.
  const db = drizzle(c.env.DB);
  const membership = await db.select({ memberId: channelMembers.memberId })
    .from(channelMembers).where(and(
      eq(channelMembers.channelId, channelId),
      eq(channelMembers.memberId, subject.userId),
      eq(channelMembers.memberType, "human"),
    )).limit(1);
  if (membership.length === 0) {
    return c.json({ error: { code: "NOT_MEMBER", message: "join the channel before muting it" } }, 403);
  }
  const now = new Date();
  await db.update(channelMembers).set({ mutedAt: now }).where(and(
    eq(channelMembers.channelId, channelId),
    eq(channelMembers.memberId, subject.userId),
    eq(channelMembers.memberType, "human"),
  ));
  // No notifyGateway here — mute is per-user and only the originating
  // user's tabs need to know; they update via the local channels-changed
  // event the UI dispatches alongside.
  return c.json({ ok: true, mutedAt: now.getTime() });
});

// ---------------------------------------------------------------------------
// POST /api/v1/channels/:id/star  +  DELETE — per-user sidebar pin
//
// Same membership requirement as mute: only members can star their
// own channels. Starred channels sort above non-starred peers in the
// sidebar but stay in the same section (no separate "Starred" group).
// Idempotent: re-starring just refreshes starred_at.
// ---------------------------------------------------------------------------
channelsRoutes.post("/api/v1/channels/:id/star", requireAuth, requireUser, async (c) => {
  const channelId = c.req.param("id");
  const subject = c.get("subject");
  const limited = await rateLimit(c, "channel_star", subject.userId, 60, 3600);
  if (limited) return limited;
  const db = drizzle(c.env.DB);
  const membership = await db.select({ memberId: channelMembers.memberId })
    .from(channelMembers).where(and(
      eq(channelMembers.channelId, channelId),
      eq(channelMembers.memberId, subject.userId),
      eq(channelMembers.memberType, "human"),
    )).limit(1);
  if (membership.length === 0) {
    return c.json({ error: { code: "NOT_MEMBER", message: "join the channel before starring it" } }, 403);
  }
  const now = new Date();
  await db.update(channelMembers).set({ starredAt: now }).where(and(
    eq(channelMembers.channelId, channelId),
    eq(channelMembers.memberId, subject.userId),
    eq(channelMembers.memberType, "human"),
  ));
  return c.json({ ok: true, starredAt: now.getTime() });
});

channelsRoutes.delete("/api/v1/channels/:id/star", requireAuth, requireUser, async (c) => {
  const channelId = c.req.param("id");
  const subject = c.get("subject");
  const limited = await rateLimit(c, "channel_unstar", subject.userId, 60, 3600);
  if (limited) return limited;
  const db = drizzle(c.env.DB);
  await db.update(channelMembers).set({ starredAt: null }).where(and(
    eq(channelMembers.channelId, channelId),
    eq(channelMembers.memberId, subject.userId),
    eq(channelMembers.memberType, "human"),
  ));
  return c.json({ ok: true });
});

channelsRoutes.delete("/api/v1/channels/:id/mute", requireAuth, requireUser, async (c) => {
  const channelId = c.req.param("id");
  const subject = c.get("subject");
  const limited = await rateLimit(c, "channel_unmute", subject.userId, 60, 3600);
  if (limited) return limited;
  // Same membership precheck as POST /mute — silent unmute would mask
  // a "I'm not actually in this channel" UX bug.
  const db = drizzle(c.env.DB);
  const membership = await db.select({ memberId: channelMembers.memberId })
    .from(channelMembers).where(and(
      eq(channelMembers.channelId, channelId),
      eq(channelMembers.memberId, subject.userId),
      eq(channelMembers.memberType, "human"),
    )).limit(1);
  if (membership.length === 0) {
    return c.json({ error: { code: "NOT_MEMBER", message: "not a member of this channel" } }, 403);
  }
  await db.update(channelMembers).set({ mutedAt: null }).where(and(
    eq(channelMembers.channelId, channelId),
    eq(channelMembers.memberId, subject.userId),
    eq(channelMembers.memberType, "human"),
  ));
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
      console.warn(JSON.stringify({
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

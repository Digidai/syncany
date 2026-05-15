import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@syncany/auth-core";
import { servers, serverMembers, agents, channels, channelMembers, messages, user } from "@syncany/db";
import { and, eq, inArray, sql as sqlFn } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";

export const serversRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/servers — list mine + lookup by slug + detail with channels
// ---------------------------------------------------------------------------
serversRoutes.get("/api/v1/servers", requireAuth, async (c) => {
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  // Machine subjects MUST be scoped to their own server — a machine key
  // for serverA must not see serverB metadata even if the same user owns
  // both. User subjects see all their server memberships.
  const memberConds = [
    eq(serverMembers.serverId, servers.id),
    eq(serverMembers.memberId, subject.userId),
    eq(serverMembers.memberType, "human"),
  ];
  if (subject.kind === "machine") memberConds.push(eq(servers.id, subject.serverId));
  const rows = await db
    .select({ s: servers, role: serverMembers.role })
    .from(servers)
    .innerJoin(serverMembers, and(...memberConds));
  return c.json({ servers: rows.map(r => ({ ...r.s, role: r.role })) });
});

serversRoutes.get("/api/v1/servers/by-slug/:slug", requireAuth, async (c) => {
  const subject = c.get("subject");
  const slug = c.req.param("slug");
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ s: servers, role: serverMembers.role })
    .from(servers)
    .innerJoin(serverMembers, and(
      eq(serverMembers.serverId, servers.id),
      eq(serverMembers.memberId, subject.userId),
      eq(serverMembers.memberType, "human"),
    ))
    .where(eq(servers.slug, slug))
    .limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such server" } }, 404);
  const server = rows[0];
  // Machine-subject scope check: only the server whose serverId matches
  // the machine key. Otherwise a key for serverA could enumerate serverB
  // by its slug.
  if (subject.kind === "machine" && server.s.id !== subject.serverId) {
    return c.json({ error: { code: "NOT_FOUND", message: "no such server" } }, 404);
  }
  const [chans, ags, unreadRows] = await Promise.all([
    db.select().from(channels).where(eq(channels.serverId, server.s.id)),
    db.select().from(agents).where(eq(agents.serverId, server.s.id)),
    // For each channel the user is a member of, max(seq) - lastReadSeq = unread.
    db.select({
      channelId: channelMembers.channelId,
      lastReadSeq: channelMembers.lastReadSeq,
    }).from(channelMembers).where(and(
      eq(channelMembers.memberId, subject.userId),
      eq(channelMembers.memberType, "human"),
    )),
  ]);
  // Compute unread per channel via a single SQL aggregation.
  const lastReadByChannel = new Map(unreadRows.map(r => [r.channelId, r.lastReadSeq ?? 0]));
  const channelIds = chans.map(c => c.id);
  const seqRows = channelIds.length === 0 ? [] : await db
    .select({ channelId: messages.channelId, maxSeq: sqlFn<number>`max(${messages.seq})` })
    .from(messages)
    .where(inArray(messages.channelId, channelIds))
    .groupBy(messages.channelId);
  const maxSeqByChannel = new Map(seqRows.map(r => [r.channelId, Number(r.maxSeq ?? 0)]));
  const channelsOut = chans.map(c => {
    // If the user isn't a member of this channel (only possible for public
    // channels they haven't explicitly joined), don't compute "unread" at all.
    const isMember = lastReadByChannel.has(c.id);
    return {
      ...c,
      unread: isMember
        ? Math.max(0, (maxSeqByChannel.get(c.id) ?? 0) - (lastReadByChannel.get(c.id) ?? 0))
        : 0,
    };
  });

  return c.json({ server: { ...server.s, role: server.role }, channels: channelsOut, agents: ags });
});

// ---------------------------------------------------------------------------
// Workspace member management — list humans + remove. Owner-only for delete.
// ---------------------------------------------------------------------------
serversRoutes.get("/api/v1/servers/:id/members", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canRead(ctx, id));
  const db = drizzle(c.env.DB);

  // Email is PII. Only admins/owners see peer emails; regular members get
  // name + role + image only. Ownership of email enumeration prevented.
  const myRow = await db
    .select({ role: serverMembers.role })
    .from(serverMembers)
    .where(and(
      eq(serverMembers.serverId, id),
      eq(serverMembers.memberId, subject.userId),
      eq(serverMembers.memberType, "human"),
    )).limit(1);
  const myRole = myRow[0]?.role ?? "member";
  const canSeeEmails = myRole === "owner" || myRole === "admin";

  const rows = await db
    .select({
      userId: serverMembers.memberId,
      role: serverMembers.role,
      joinedAt: serverMembers.joinedAt,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(serverMembers)
    .innerJoin(user, eq(user.id, serverMembers.memberId))
    .where(and(
      eq(serverMembers.serverId, id),
      eq(serverMembers.memberType, "human"),
    ));
  const out = rows.map(r => canSeeEmails ? r : { ...r, email: null });
  return c.json({ members: out, viewerRole: myRole });
});

serversRoutes.delete("/api/v1/servers/:id/members/:userId", requireAuth, async (c) => {
  const id = c.req.param("id");
  const targetUserId = c.req.param("userId");
  const subject = c.get("subject");
  const ctx = ctxFor(c);
  // Owner-only via policy.servers.canUpdate. Server owner cannot kick themselves.
  await requirePolicy(policy.servers.canUpdate(ctx, id));
  if (targetUserId === subject.userId) {
    return c.json({ error: { code: "BAD_REQ", message: "owner cannot remove themselves; transfer ownership first" } }, 400);
  }
  const db = drizzle(c.env.DB);
  // Two-step: enumerate the server's channels first, then delete the
  // target user's channel-memberships + server-membership in one batch.
  const chanRows = await db.select({ id: channels.id }).from(channels).where(eq(channels.serverId, id));
  const chanIds = chanRows.map(r => r.id);
  // Two sequential deletes — D1 doesn't need a transaction here because
  // even a partial failure leaves the user only-partially-removed (still
  // in some channels), which a retry of the endpoint cleans up. No
  // exposure beyond the one server we're touching.
  if (chanIds.length > 0) {
    await db.delete(channelMembers).where(and(
      eq(channelMembers.memberId, targetUserId),
      eq(channelMembers.memberType, "human"),
      inArray(channelMembers.channelId, chanIds),
    ));
  }
  await db.delete(serverMembers).where(and(
    eq(serverMembers.serverId, id),
    eq(serverMembers.memberId, targetUserId),
    eq(serverMembers.memberType, "human"),
  ));
  return c.json({ ok: true });
});

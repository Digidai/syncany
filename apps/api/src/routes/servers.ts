import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { servers, serverMembers, agents, channels, channelMembers, messages } from "@syncany/db";
import { and, eq, inArray, sql as sqlFn } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth } from "../lib/auth";

export const serversRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/servers — list mine + lookup by slug + detail with channels
// ---------------------------------------------------------------------------
serversRoutes.get("/api/v1/servers", requireAuth, async (c) => {
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ s: servers, role: serverMembers.role })
    .from(servers)
    .innerJoin(serverMembers, and(
      eq(serverMembers.serverId, servers.id),
      eq(serverMembers.memberId, subject.userId),
      eq(serverMembers.memberType, "human"),
    ));
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

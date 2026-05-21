/**
 * GET /api/v1/inbox?serverId=… — unified inbox surface.
 *
 * Aggregates two signals into a single chronological list:
 *   1. Unread DMs: every DM channel the caller is in where the latest
 *      message's seq exceeds their last_read_seq AND the latest sender
 *      isn't the caller themselves.
 *   2. Open task assignments: tasks where assignee_id = caller and
 *      status ∈ (todo, in_progress), ordered by created_at desc.
 *
 * Why no @-mention source yet:
 *   The messages table doesn't index mentioned user ids — adding one
 *   means a schema migration and a write-time extraction step. MVP
 *   inbox covers the two highest-signal sources without DB churn;
 *   mentions land in a follow-up.
 *
 * Why server-scoped (`?serverId=` required):
 *   A user can be in N workspaces; surfacing all inboxes mixed together
 *   would conflict with our existing "you're in one workspace at a time"
 *   sidebar mental model. Workspace switcher handles cross-workspace
 *   awareness; inbox stays scoped.
 *
 * Why no persisted "last inbox read":
 *   We piggyback on channelMembers.last_read_seq for DM unread; for tasks
 *   we always show open ones. UI can mark items as "seen" client-side
 *   via localStorage to fade them visually; deciding-they're-handled is
 *   the user clicking through to the source channel.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@raltic/auth-core";
import { messages, channels, channelMembers, tasks, servers } from "@raltic/db";
import { and, desc, eq, or } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";

export const inboxRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

interface InboxItem {
  id: string;
  kind: "dm" | "task";
  createdAt: number;
  channelId: string;
  channelName: string;
  channelType: "public" | "private" | "dm";
  preview: string;
  href: string;
}

inboxRoutes.get("/api/v1/inbox", requireAuth, async (c) => {
  const subject = c.get("subject");
  if (subject.kind !== "user") {
    return c.json({ items: [] });
  }
  const serverIdParam = c.req.query("serverId");
  if (!serverIdParam) {
    return c.json({ error: { code: "BAD_REQ", message: "serverId required" } }, 400);
  }
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canRead(ctx, serverIdParam));

  const db = drizzle(c.env.DB);

  // Workspace slug used for href construction. One small lookup; we
  // could pass slug in the URL instead, but server_id is the stable
  // identifier and the slug can change (via PATCH /servers/:id).
  const srv = await db.select({ slug: servers.slug })
    .from(servers).where(eq(servers.id, serverIdParam)).limit(1);
  const slug = srv[0]?.slug ?? serverIdParam;

  // ── 1. Unread DMs ──────────────────────────────────────────────────────
  const dmMemberships = await db
    .select({
      channelId: channels.id,
      channelName: channels.name,
      lastReadSeq: channelMembers.lastReadSeq,
    })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(and(
      eq(channelMembers.memberId, subject.userId),
      eq(channelMembers.memberType, "human"),
      eq(channels.type, "dm"),
      eq(channels.serverId, serverIdParam),
    ));

  const dmItems: InboxItem[] = [];
  for (const dm of dmMemberships) {
    const latest = await db.select({
      id: messages.id, seq: messages.seq, content: messages.content,
      createdAt: messages.createdAt, senderId: messages.senderId,
    })
      .from(messages)
      .where(eq(messages.channelId, dm.channelId))
      .orderBy(desc(messages.seq))
      .limit(1);
    const top = latest[0];
    if (!top) continue;
    if ((dm.lastReadSeq ?? 0) >= top.seq) continue;
    if (top.senderId === subject.userId) continue;
    dmItems.push({
      id: `dm:${top.id}`,
      kind: "dm",
      createdAt: top.createdAt instanceof Date ? top.createdAt.getTime() : Number(top.createdAt),
      channelId: dm.channelId,
      channelName: dm.channelName,
      channelType: "dm",
      preview: top.content.slice(0, 140),
      href: `/s/${slug}/dm/${dm.channelId}`,
    });
  }

  // ── 2. Open tasks assigned to me ───────────────────────────────────────
  // tasks doesn't store a title — the title is the source message's content.
  // LEFT JOIN messages so a task whose message got hard-deleted still
  // surfaces (preview falls back to "Task #N").
  const myTasks = await db
    .select({
      tId: tasks.id, tNumber: tasks.taskNumber,
      tStatus: tasks.status, tCreatedAt: tasks.createdAt, tChannelId: tasks.channelId,
      tMessageId: tasks.messageId,
      mContent: messages.content,
      cName: channels.name, cType: channels.type,
    })
    .from(tasks)
    .innerJoin(channels, eq(channels.id, tasks.channelId))
    .leftJoin(messages, eq(messages.id, tasks.messageId))
    .where(and(
      eq(channels.serverId, serverIdParam),
      eq(tasks.assigneeId, subject.userId),
      eq(tasks.assigneeType, "human"),
      or(eq(tasks.status, "todo"), eq(tasks.status, "in_progress")),
    ))
    .orderBy(desc(tasks.createdAt))
    .limit(20);

  const taskItems: InboxItem[] = myTasks.map((t) => ({
    id: `task:${t.tId}`,
    kind: "task",
    createdAt: t.tCreatedAt instanceof Date ? t.tCreatedAt.getTime() : Number(t.tCreatedAt),
    channelId: t.tChannelId,
    channelName: t.cName,
    channelType: t.cType,
    preview: (t.mContent ?? `Task #${t.tNumber}`).slice(0, 140),
    href: `/s/${slug}/${t.cType === "dm" ? "dm" : "channel"}/${t.tChannelId}`,
  }));

  const items = [...dmItems, ...taskItems]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);

  return c.json({ items, count: items.length });
});

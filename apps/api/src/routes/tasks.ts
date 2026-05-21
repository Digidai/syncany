import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@raltic/auth-core";
import { createTaskRequest, updateTaskRequest, listTasksQuery } from "@raltic/protocol";
import { channelMembers, channels, messages, tasks } from "@raltic/db";
import { and, desc, eq } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";

export const tasksRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/tasks — list / create / update (incl. claim/unclaim)
// ---------------------------------------------------------------------------
tasksRoutes.get("/api/v1/tasks", requireAuth, async (c) => {
  const q = listTasksQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const ctx = ctxFor(c);
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);

  // Helper to derive title from the linked message — strips the standard
  // "📋 Task #N: " prefix the DO inserts on task creation. Falls back to
  // the raw content if the prefix isn't present (older rows).
  const titleFromMessage = (content: string | null): string => {
    if (!content) return "(no title)";
    const m = /^📋\s*Task\s*#\d+:\s*(.+)$/s.exec(content);
    return (m ? m[1] : content).slice(0, 200);
  };

  if (q.channelId) {
    await requirePolicy(policy.tasks.canRead(ctx, q.channelId));
    const conds = [eq(tasks.channelId, q.channelId)];
    if (q.status) conds.push(eq(tasks.status, q.status));
    if (q.assigneeId) conds.push(eq(tasks.assigneeId, q.assigneeId));
    const rows = await db
      .select({ t: tasks, content: messages.content })
      .from(tasks)
      .leftJoin(messages, eq(messages.id, tasks.messageId))
      .where(and(...conds))
      .orderBy(desc(tasks.createdAt))
      .limit(q.limit);
    return c.json({ tasks: rows.map(r => ({ ...r.t, title: titleFromMessage(r.content) })) });
  }

  // No channel filter → list across channels visible to subject's agents/self.
  // Membership join below already constrains to subject's channels (humans).
  // For machine subjects we additionally constrain via the channel's serverId
  // so a key for serverA can't enumerate serverB tasks even if the user is
  // a member of both servers.
  const conds = [
    eq(channelMembers.channelId, tasks.channelId),
    eq(channelMembers.memberId, subject.userId),
  ];
  const rows = await db
    .select({ t: tasks, content: messages.content, serverId: channels.serverId })
    .from(tasks)
    .innerJoin(channelMembers, and(...conds))
    .innerJoin(channels, eq(channels.id, tasks.channelId))
    .leftJoin(messages, eq(messages.id, tasks.messageId))
    .where(and(
      q.status ? eq(tasks.status, q.status) : undefined,
      subject.kind === "machine" ? eq(channels.serverId, subject.serverId) : undefined,
    ))
    .orderBy(desc(tasks.createdAt))
    .limit(q.limit);
  return c.json({ tasks: rows.map(r => ({ ...r.t, title: titleFromMessage(r.content) })) });
});

tasksRoutes.post("/api/v1/tasks", requireAuth, async (c) => {
  const subject = c.get("subject");
  // 100/hour/user — task creation can be bursty (agent triages incoming
  // messages into tasks), but anything beyond this is more likely a bug
  // or abuse than legitimate human flow.
  const limited = await rateLimit(c, "task_create", subject.userId, 100, 3600);
  if (limited) return limited;
  const body = createTaskRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  await requirePolicy(policy.tasks.canManage(ctx, body.channelId));
  // Per-channel cap — task creation is bursty per agent but a channel
  // shouldn't legitimately accumulate >500 new tasks/hour from any combo
  // of members. Caught after policy to avoid probing.
  const chanLimited = await rateLimit(c, "task_create_chan", body.channelId, 500, 3600);
  if (chanLimited) return chanLimited;

  const db = drizzle(c.env.DB);

  // 1. Allocate task_number atomically via INSERT-then-retry on UNIQUE
  //    collision. Row is inserted with messageId=null; the DO send happens
  //    AFTER we know the committed task_number, then we back-fill messageId.
  //    This avoids the prior bug where retry posted duplicate user-visible
  //    chat messages with diverging task numbers.
  const id = crypto.randomUUID();
  const now = new Date();
  let taskNumber = 0;
  let inserted = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db.select({ max: tasks.taskNumber })
      .from(tasks).where(eq(tasks.channelId, body.channelId));
    taskNumber = (existing.reduce((m, r) => Math.max(m, r.max ?? 0), 0)) + 1;
    try {
      await db.insert(tasks).values({
        id, messageId: null, channelId: body.channelId,
        taskNumber, status: "todo",
        assigneeId: body.assigneeId ?? null,
        assigneeType: body.assigneeType ?? null,
        createdAt: now, updatedAt: now,
      });
      inserted = true;
      break;
    } catch (e) {
      // Unique-constraint codes vary by D1 version; "UNIQUE" or "constraint"
      // both cover SQLite's text. Retry on conflict, surface anything else.
      const m = String(e);
      if ((m.includes("UNIQUE") || m.includes("constraint")) && attempt < 4) continue;
      throw e;
    }
  }
  if (!inserted) {
    return c.json({ error: { code: "TASK_CONFLICT", message: "could not allocate task number after retries" } }, 409);
  }

  // 2. Now post the chat message with the COMMITTED task_number. Idempotency
  //    key is stable (per task id) so any retry of THIS endpoint dedupes.
  const stub = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(body.channelId));
  const sendRes = await stub.fetch("https://chat-room/internal/send", {
    method: "POST",
    headers: { "x-internal-secret": c.env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
    body: JSON.stringify({
      channelId: body.channelId,
      senderId: subject.userId,
      senderType: "human",
      content: `📋 Task #${taskNumber}: ${body.title}`,
      threadParentId: null,
      idempotencyKey: `task-create-${id}`,
    }),
  });
  if (!sendRes.ok) {
    // Row exists but message didn't post — leave row with null messageId so
    // a manual retry endpoint (future work) can backfill it. Return success
    // since the task itself was created.
    return c.json({ id, taskNumber, messageId: null, seq: null, warning: "task created but chat message failed" });
  }
  const messageRes = await sendRes.json() as { ok: boolean; seq: number; messageId: string };

  // 3. Backfill the messageId so the UI can link task ↔ message.
  await db.update(tasks).set({ messageId: messageRes.messageId }).where(eq(tasks.id, id));

  return c.json({ id, taskNumber, messageId: messageRes.messageId, seq: messageRes.seq });
});

tasksRoutes.patch("/api/v1/tasks/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  // 200 task-patches/min/user — Kanban drag/drop fires rapid status
  // updates; agents bulk-triage in bursts. Cap protects D1 from a
  // runaway script.
  const limited = await rateLimit(c, "task_patch", subject.userId, 200, 60);
  if (limited) return limited;
  const body = updateTaskRequest.parse(await c.req.json());
  const db = drizzle(c.env.DB);
  const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (existing.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such task" } }, 404);
  const ctx = ctxFor(c);
  await requirePolicy(policy.tasks.canManage(ctx, existing[0].channelId));

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.status !== undefined) patch.status = body.status;
  if (body.assigneeId !== undefined) patch.assigneeId = body.assigneeId;
  if (body.assigneeType !== undefined) patch.assigneeType = body.assigneeType;
  await db.update(tasks).set(patch).where(eq(tasks.id, id));
  return c.json({ ok: true });
});

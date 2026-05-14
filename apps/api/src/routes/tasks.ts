import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@syncany/auth-core";
import { createTaskRequest, updateTaskRequest, listTasksQuery } from "@syncany/protocol";
import { channelMembers, messages, tasks } from "@syncany/db";
import { and, desc, eq } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";

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
  const rows = await db
    .select({ t: tasks, content: messages.content })
    .from(tasks)
    .innerJoin(channelMembers, and(
      eq(channelMembers.channelId, tasks.channelId),
      eq(channelMembers.memberId, subject.userId),
    ))
    .leftJoin(messages, eq(messages.id, tasks.messageId))
    .where(q.status ? eq(tasks.status, q.status) : undefined)
    .orderBy(desc(tasks.createdAt))
    .limit(q.limit);
  return c.json({ tasks: rows.map(r => ({ ...r.t, title: titleFromMessage(r.content) })) });
});

tasksRoutes.post("/api/v1/tasks", requireAuth, async (c) => {
  const body = createTaskRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  const subject = c.get("subject");
  await requirePolicy(policy.tasks.canManage(ctx, body.channelId));

  const db = drizzle(c.env.DB);

  // Allocate the next task_number with a write-side conditional INSERT so
  // concurrent callers can't both compute the same number. Retry up to 5
  // times if UNIQUE(channel_id, task_number) collides.
  const id = crypto.randomUUID();
  const now = new Date();
  let taskNumber = 0;
  let messageRes: { ok?: boolean; seq?: number; messageId?: string } = {};

  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db.select({ max: tasks.taskNumber })
      .from(tasks).where(eq(tasks.channelId, body.channelId));
    taskNumber = (existing.reduce((m, r) => Math.max(m, r.max ?? 0), 0)) + 1;

    // 1. Send the chat message via the ChatRoom DO so it gets a real seq
    //    (no more seq=0 hack) AND broadcasts to live subscribers.
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
      return c.json({ error: { code: "TASK_SEND_FAILED", message: "DO rejected task system message" } }, 500);
    }
    messageRes = await sendRes.json() as { ok: boolean; seq: number; messageId: string };

    // 2. Insert the task row referencing the DO-allocated message.
    try {
      await db.insert(tasks).values({
        id, messageId: messageRes.messageId!, channelId: body.channelId,
        taskNumber, status: "todo",
        assigneeId: body.assigneeId ?? null,
        assigneeType: body.assigneeType ?? null,
        createdAt: now, updatedAt: now,
      });
      return c.json({ id, taskNumber, messageId: messageRes.messageId, seq: messageRes.seq });
    } catch (e) {
      // UNIQUE collision on (channel_id, task_number) → another caller raced
      // us. Loop and try the next number.
      if (String(e).includes("UNIQUE") && attempt < 4) continue;
      throw e;
    }
  }
  return c.json({ error: { code: "TASK_CONFLICT", message: "could not allocate task number after retries" } }, 409);
});

tasksRoutes.patch("/api/v1/tasks/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
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

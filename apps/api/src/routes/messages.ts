import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@syncany/auth-core";
import { sendMessageRequest, editMessageRequest, toggleReactionRequest } from "@syncany/protocol";
import { agents, messages, reactions } from "@syncany/db";
import { and, eq } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { broadcastMessageUpdate, broadcastReaction } from "../lib/notify";

export const messagesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/messages — POST sends, route resolves to channel DO
// ---------------------------------------------------------------------------
messagesRoutes.post("/api/v1/messages", requireAuth, async (c) => {
  const subject = c.get("subject");
  const limited = await rateLimit(c, "msg_send", subject.userId, 120, 60); // 120/min/user
  if (limited) return limited;
  const body = sendMessageRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  const senderType = body.as ? "agent" : "human";
  const senderId = body.as ?? subject.userId;
  await requirePolicy(policy.messages.canSendAs(ctx, {
    channelId: body.channelId, senderId, senderType,
  }));
  // Route through the channel's DO so seq is allocated AND broadcast happens.
  const stub = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(body.channelId));
  const res = await stub.fetch("https://chat-room/internal/send", {
    method: "POST",
    headers: { "x-internal-secret": c.env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
    body: JSON.stringify({
      channelId: body.channelId,
      senderId,
      senderType,
      content: body.content,
      threadParentId: body.threadParentId ?? null,
      idempotencyKey: body.idempotencyKey,
    }),
  });
  if (!res.ok) {
    return c.json({ error: { code: "SEND_FAILED", message: "channel DO rejected message" } }, 500);
  }
  const data = await res.json() as { ok: true; seq: number; messageId?: string };
  return c.json(data);
});

// ---------------------------------------------------------------------------
// /api/v1/messages/:id — edit / soft-delete
// ---------------------------------------------------------------------------
messagesRoutes.patch("/api/v1/messages/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const body = editMessageRequest.parse(await c.req.json());
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such message" } }, 404);
  const m = rows[0];
  // Only original sender can edit. (For agent messages, only the agent's owner.)
  let allowed = m.senderId === subject.userId;
  if (!allowed && m.senderType === "agent") {
    const own = await db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.id, m.senderId), eq(agents.ownerId, subject.userId))).limit(1);
    allowed = own.length > 0;
  }
  if (!allowed) return c.json({ error: { code: "FORBIDDEN", message: "not your message" } }, 403);
  if (m.deletedAt) return c.json({ error: { code: "GONE", message: "message deleted" } }, 410);

  const editedAt = new Date();
  await db.update(messages).set({ content: body.content, editedAt, updatedAt: editedAt }).where(eq(messages.id, id));

  // Broadcast update via DO so live tabs update without poll.
  await broadcastMessageUpdate(c.env, m.channelId, { ...m, content: body.content, editedAt, updatedAt: editedAt });
  return c.json({ ok: true });
});

messagesRoutes.delete("/api/v1/messages/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such message" } }, 404);
  const m = rows[0];
  let allowed = m.senderId === subject.userId;
  if (!allowed && m.senderType === "agent") {
    const own = await db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.id, m.senderId), eq(agents.ownerId, subject.userId))).limit(1);
    allowed = own.length > 0;
  }
  if (!allowed) return c.json({ error: { code: "FORBIDDEN", message: "not your message" } }, 403);

  const deletedAt = new Date();
  await db.update(messages).set({
    content: "_(deleted)_",
    deletedAt, updatedAt: deletedAt,
  }).where(eq(messages.id, id));
  await broadcastMessageUpdate(c.env, m.channelId, { ...m, content: "_(deleted)_", deletedAt, updatedAt: deletedAt });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/v1/messages/:id/reactions — add or remove (toggle)
// ---------------------------------------------------------------------------
messagesRoutes.post("/api/v1/messages/:id/reactions", requireAuth, async (c) => {
  const messageId = c.req.param("id");
  const body = toggleReactionRequest.parse(await c.req.json());
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  const reactorType = body.reactorType ?? "human";
  const reactorId = body.reactorId ?? subject.userId;
  // If reacting as an agent, must own it.
  if (reactorType === "agent") {
    const own = await db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.id, reactorId), eq(agents.ownerId, subject.userId))).limit(1);
    if (own.length === 0) return c.json({ error: { code: "FORBIDDEN", message: "not your agent" } }, 403);
  }
  // Find the channel via the message — channel membership = react permission.
  const m = await db.select({ channelId: messages.channelId }).from(messages).where(eq(messages.id, messageId)).limit(1);
  if (m.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such message" } }, 404);
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canRead(ctx, m[0].channelId));

  // Toggle: if exists, remove; else add.
  const existing = await db.select().from(reactions)
    .where(and(eq(reactions.messageId, messageId), eq(reactions.reactorId, reactorId), eq(reactions.emoji, body.emoji)))
    .limit(1);
  let added: boolean;
  if (existing.length > 0) {
    await db.delete(reactions)
      .where(and(eq(reactions.messageId, messageId), eq(reactions.reactorId, reactorId), eq(reactions.emoji, body.emoji)));
    added = false;
  } else {
    await db.insert(reactions).values({ messageId, reactorId, reactorType, emoji: body.emoji, createdAt: new Date() });
    added = true;
  }

  await broadcastReaction(c.env, m[0].channelId, { messageId, emoji: body.emoji, reactorId, added });
  return c.json({ ok: true, added });
});

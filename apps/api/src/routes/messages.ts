import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@raltic/auth-core";
import { sendMessageRequest, editMessageRequest, toggleReactionRequest } from "@raltic/protocol";
import { agents, channels, channelMembers, messages, reactions } from "@raltic/db";
import { and, eq } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, requireUser, ctxFor } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { broadcastMessageUpdate, broadcastReaction } from "../lib/notify";
import { dispatchToAgents, extractAgentMentions, resolveChannelAgents } from "../lib/agent-dispatch";

export const messagesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/messages — POST sends, route resolves to channel DO
// ---------------------------------------------------------------------------
messagesRoutes.post("/api/v1/messages", requireAuth, async (c) => {
  const subject = c.get("subject");
  // Per-user cap blocks single-account abuse; per-channel + per-workspace
  // caps stop a 50-person workspace from legally summing to firehose
  // traffic against ChatRoom DOs and downstream notifications.
  const limited = await rateLimit(c, "msg_send", subject.userId, 120, 60);
  if (limited) return limited;
  const body = sendMessageRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  const senderType = body.as ? "agent" : "human";
  const senderId = body.as ?? subject.userId;
  await requirePolicy(policy.messages.canSendAs(ctx, {
    channelId: body.channelId, senderId, senderType,
  }));
  // Per-channel cap runs AFTER policy so an unauthorized caller can't
  // probe channel quota / observe 429-vs-403 to enumerate membership.
  const channelLimited = await rateLimit(c, "msg_send_chan", body.channelId, 600, 60);
  if (channelLimited) return channelLimited;
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

  // P0 W3: dispatch @-mentioned cloud agents (runtime_mode='raltic').
  // Best-effort: never fail the original post if dispatch errors.
  // Limit candidates to agents in this workspace's channel members —
  // /agents API surface is per-workspace, but here we lazily expand
  // the candidate set to all agents @mention syntax may target.
  if (data.messageId && senderType === "human") {
    // P0 debug: dispatch inline (await) instead of waitUntil. Slower for
    // the user (response blocks on agent completion ~1-3s) but rules out
    // cross-isolate waitUntil tracking issues. TODO: switch back to
    // waitUntil after we've verified end-to-end works at least once.
    try {
      // Resolve channel-member agents (id + name).
      const candidates = await resolveChannelAgents(c.env, body.channelId);
      if (candidates.length > 0) {
        // Two dispatch triggers:
        //   1. Explicit @-mention (any channel type)
        //   2. DM channel with exactly one agent member — every message
        //      auto-dispatches (no @-mention required). DM with an
        //      agent = private chat with that agent.
        let mentioned = extractAgentMentions(body.content, candidates);
        if (mentioned.length === 0) {
          const db = drizzle(c.env.DB);
          const ch = await db.select({ type: channels.type })
            .from(channels)
            .where(eq(channels.id, body.channelId))
            .limit(1);
          if (ch[0]?.type === "dm" && candidates.length === 1) {
            mentioned = [candidates[0]!.id];
          }
        }
        if (mentioned.length > 0) {
          await dispatchToAgents(c.env, {
            channelId: body.channelId,
            messageId: data.messageId!,
            text: body.content,
            callerId: senderId,
            callerType: senderType,
            mentionedAgentIds: mentioned,
          });
        }
      }
    } catch (e) {
      console.error("[messages.post] agent dispatch failed:", e);
    }
  }

  return c.json(data);
});

// ---------------------------------------------------------------------------
// /api/v1/messages/:id — edit / soft-delete
// ---------------------------------------------------------------------------
messagesRoutes.patch("/api/v1/messages/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  // 60 edits/min/user — a legit user fixing typos burst-edits a few
  // times, never per-second; cap suspicious edit storms.
  const limited = await rateLimit(c, "msg_edit", subject.userId, 60, 60);
  if (limited) return limited;
  const body = editMessageRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such message" } }, 404);
  const m = rows[0];
  // Edit permission goes through policy.messages.canEdit — same enforcement
  // surface as the other routes (covers machine-key serverId scoping too).
  await requirePolicy(policy.messages.canEdit(ctx, { senderId: m.senderId, senderType: m.senderType }));
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
  // 30 deletes/min/user — same intent as edit; bounds delete-spam.
  const limited = await rateLimit(c, "msg_delete", subject.userId, 30, 60);
  if (limited) return limited;
  const ctx = ctxFor(c);
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such message" } }, 404);
  const m = rows[0];
  await requirePolicy(policy.messages.canEdit(ctx, { senderId: m.senderId, senderType: m.senderType }));

  const deletedAt = new Date();
  await db.update(messages).set({
    content: "_(deleted)_",
    deletedAt, updatedAt: deletedAt,
  }).where(eq(messages.id, id));
  await broadcastMessageUpdate(c.env, m.channelId, { ...m, content: "_(deleted)_", deletedAt, updatedAt: deletedAt });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/v1/messages/:id/pin — pin/unpin a message (channel-global)
//
// Pin is channel-scoped (not per-user) — pinned messages become the
// channel's persistent context bar. Any channel member can pin or
// unpin (low-stakes, reversible, agents reference pinned content as
// channel context). DMs and system messages are pinnable too.
//
// POST   /pin → set pinned_at = now, pinned_by = subject.userId
// DELETE /pin → clear both (idempotent — already-unpinned is no-op)
// ---------------------------------------------------------------------------
messagesRoutes.post("/api/v1/messages/:id/pin", requireAuth, requireUser, async (c) => {
  const messageId = c.req.param("id");
  const subject = c.get("subject");
  const limited = await rateLimit(c, "msg_pin", subject.userId, 60, 60);
  if (limited) return limited;
  const db = drizzle(c.env.DB);
  const rows = await db.select({ id: messages.id, channelId: messages.channelId }).from(messages)
    .where(eq(messages.id, messageId)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such message" } }, 404);
  const ctx = ctxFor(c);
  // Channel membership gate — agent owners count via canRead's
  // userHasAgentInChannel branch.
  await requirePolicy(policy.channels.canRead(ctx, rows[0].channelId));
  const now = new Date();
  await db.update(messages).set({ pinnedAt: now, pinnedBy: subject.userId })
    .where(eq(messages.id, messageId));
  // Broadcast so other tabs in the channel update their pinned bar.
  // Use the existing message_update channel so we don't add a new
  // event type for a small field. Tabs re-render the pin marker by
  // diffing pinnedAt.
  const updated = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (updated[0]) await broadcastMessageUpdate(c.env, rows[0].channelId, updated[0]);
  return c.json({ ok: true, pinnedAt: now.getTime() });
});

messagesRoutes.delete("/api/v1/messages/:id/pin", requireAuth, requireUser, async (c) => {
  const messageId = c.req.param("id");
  const subject = c.get("subject");
  const limited = await rateLimit(c, "msg_unpin", subject.userId, 60, 60);
  if (limited) return limited;
  const db = drizzle(c.env.DB);
  const rows = await db.select({ id: messages.id, channelId: messages.channelId, pinnedAt: messages.pinnedAt }).from(messages)
    .where(eq(messages.id, messageId)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such message" } }, 404);
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canRead(ctx, rows[0].channelId));
  if (rows[0].pinnedAt == null) return c.json({ ok: true, alreadyUnpinned: true });
  await db.update(messages).set({ pinnedAt: null, pinnedBy: null })
    .where(eq(messages.id, messageId));
  const updated = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (updated[0]) await broadcastMessageUpdate(c.env, rows[0].channelId, updated[0]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/v1/messages/:id/reactions — add or remove (toggle)
// ---------------------------------------------------------------------------
messagesRoutes.post("/api/v1/messages/:id/reactions", requireAuth, async (c) => {
  const messageId = c.req.param("id");
  const subject = c.get("subject");
  // 300 reactions/min/user. Reactions are bursty (user emoji-bombs a
  // chain) but no legit flow needs > 5/s sustained.
  const limited = await rateLimit(c, "reaction_toggle", subject.userId, 300, 60);
  if (limited) return limited;
  const body = toggleReactionRequest.parse(await c.req.json());
  const db = drizzle(c.env.DB);
  const reactorType = body.reactorType ?? "human";
  // Human reactor: identity is ALWAYS the subject — never trust
  // body.reactorId for human reactions. Earlier code accepted
  // `body.reactorId ?? subject.userId`, which let a caller spoof a
  // reaction as another user by passing their id (codex review caught
  // this as a HIGH bypass). Agent reactor: trust body.reactorId but
  // require subject owns the agent AND the agent is a member of the
  // message's channel (otherwise an agent can react in channels it
  // was never invited to).
  let reactorId: string;
  if (reactorType === "human") {
    reactorId = subject.userId;
  } else {
    if (!body.reactorId) {
      return c.json({ error: { code: "INVALID", message: "reactorId required for agent reactions" } }, 400);
    }
    reactorId = body.reactorId;
    const own = await db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.id, reactorId), eq(agents.ownerId, subject.userId))).limit(1);
    if (own.length === 0) return c.json({ error: { code: "FORBIDDEN", message: "not your agent" } }, 403);
  }
  // Find the channel via the message — channel membership = react permission.
  const m = await db.select({ channelId: messages.channelId }).from(messages).where(eq(messages.id, messageId)).limit(1);
  if (m.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such message" } }, 404);
  const ctx = ctxFor(c);
  await requirePolicy(policy.channels.canRead(ctx, m[0].channelId));
  // Agent reactor must additionally be a member of the message's channel —
  // otherwise an owner could "react" via an agent that isn't actually in
  // the conversation, bypassing the agent's normal channel-membership gate.
  if (reactorType === "agent") {
    const isMember = await db.select({ channelId: channelMembers.channelId })
      .from(channelMembers)
      .where(and(
        eq(channelMembers.channelId, m[0].channelId),
        eq(channelMembers.memberId, reactorId),
        eq(channelMembers.memberType, "agent"),
      ))
      .limit(1);
    if (isMember.length === 0) {
      return c.json({ error: { code: "FORBIDDEN", message: "agent not in this channel" } }, 403);
    }
  }

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

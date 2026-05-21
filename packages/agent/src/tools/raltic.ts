/**
 * Raltic-native tools — in-Worker, no container needed.
 *
 * Tools here are the cheapest to invoke (no spawn, no RPC, just D1 /
 * Vectorize / DO calls) so the agent loop should prefer them when a
 * task can be done without touching the file system.
 */
import { tool } from "ai";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray } from "drizzle-orm";
import { messages, channels, channelMembers } from "@raltic/db/schema";
import type { ToolDispatchCtx, ToolRegistry } from "./registry.js";

/** Resolve which channel ids this agent is a member of. Used to filter
 *  search results (D8 enforcement + per-channel ACL) and to gate
 *  post_to_channel against arbitrary writes triggered by prompt injection. */
async function agentChannelIds(ctx: ToolDispatchCtx): Promise<string[]> {
  const db = drizzle(ctx.env.DB);
  const rows = await db.select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(and(
      eq(channelMembers.memberId, ctx.state.agentId),
      eq(channelMembers.memberType, "agent"),
    ));
  return rows.map(r => r.channelId);
}

export function ralticTools(ctx: ToolDispatchCtx): ToolRegistry {
  return {
    search_messages: tool({
      description:
        "Semantic search over message history of channels this agent is a member of. Returns top-K matches with content preview. Use when the user asks 'find that discussion about X' or 'what did we decide about Y'.",
      inputSchema: z.object({
        query: z.string().min(1).max(1024),
        limit: z.number().int().positive().max(50).default(10),
      }),
      execute: async ({ query, limit }) => {
        if (!ctx.env.AI || !ctx.env.VECTORIZE) {
          return { matches: [], error: "AI / Vectorize bindings not configured" };
        }
        // D8 + agent ACL: workspaceId filter + per-channel membership.
        // workspaceId filter goes through Vectorize metadata (cheap);
        // channel-level filter is a post-pass in SQL since Vectorize
        // doesn't support `IN` filters for arbitrary set membership.
        const allowed = await agentChannelIds(ctx);
        if (allowed.length === 0) return { matches: [] };
        const emb = await ctx.env.AI.run(
          "@cf/baai/bge-base-en-v1.5",
          { text: [query] },
        ) as { data: number[][] };
        const vec = emb.data[0];
        if (!vec) return { matches: [] };
        // Over-fetch (3x) since we filter to allowed channels in SQL.
        const matches = await ctx.env.VECTORIZE.query(vec, {
          topK: Math.min(limit * 3, 150),
          filter: { workspaceId: ctx.state.workspaceId },
          returnMetadata: "all",
        });
        if (matches.matches.length === 0) return { matches: [] };
        const db = drizzle(ctx.env.DB);
        const rows = await db.select({
          id: messages.id,
          channelId: messages.channelId,
          senderId: messages.senderId,
          content: messages.content,
          createdAt: messages.createdAt,
        }).from(messages).where(and(
          inArray(messages.id, matches.matches.map(m => m.id)),
          inArray(messages.channelId, allowed),   // agent ACL
        ));
        return {
          matches: rows.slice(0, limit).map(r => ({
            messageId: r.id,
            channelId: r.channelId,
            senderId: r.senderId,
            preview: r.content.slice(0, 200),
            createdAt: r.createdAt,
          })),
        };
      },
    }),

    post_to_channel: tool({
      description:
        "Post a message into a channel the agent is a member of. Returns the new message id. Refuses channels the agent is not a member of (even within the same workspace).",
      inputSchema: z.object({
        channelId: z.string().min(1),
        content: z.string().min(1).max(8000),
        threadParentId: z.string().nullable().optional(),
      }),
      execute: async ({ channelId, content, threadParentId }) => {
        // Agent ACL: verify channel exists in this workspace AND that
        // this agent is a member of it. Codex review flagged the prior
        // workspace-only check as too lax — it let prompt injection
        // post into private channels in the same workspace.
        const db = drizzle(ctx.env.DB);
        const member = await db.select({ id: channelMembers.memberId })
          .from(channelMembers)
          .innerJoin(channels, eq(channels.id, channelMembers.channelId))
          .where(and(
            eq(channelMembers.channelId, channelId),
            eq(channelMembers.memberId, ctx.state.agentId),
            eq(channelMembers.memberType, "agent"),
            eq(channels.serverId, ctx.state.workspaceId),
          )).limit(1);
        if (member.length === 0) {
          throw new Error("agent is not a member of this channel");
        }
        // Route through ChatRoom DO's /internal/send (the existing,
        // production path) so seq allocation, D1 flush, fanout, and
        // unread-counter bumps all happen identically to a human post.
        const stub = ctx.env.CHAT_ROOM.get(
          ctx.env.CHAT_ROOM.idFromName(channelId),
        );
        const idempotencyKey = `agent-tool:${ctx.state.agentId}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
        const res = await stub.fetch("https://chat-room/internal/send", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-secret": ctx.env.CHAT_ROOM_AUTH_SECRET,
          },
          body: JSON.stringify({
            channelId,
            senderId: ctx.state.agentId,
            senderType: "agent",
            content,
            threadParentId: threadParentId ?? null,
            idempotencyKey,
          }),
        });
        if (!res.ok) throw new Error(`post_to_channel failed: HTTP ${res.status}`);
        const body = await res.json() as { messageId: string; seq: number };
        return body;
      },
    }),

    set_todo: tool({
      description:
        "Replace the agent's current plan/todo list with a new structured list. Use this to break a multi-step request into trackable items the user can see. Items not in the new list are dropped (use mark_todo_done if you just want to mark completion).",
      inputSchema: z.object({
        items: z.array(z.object({
          id: z.string().min(1).max(64),
          title: z.string().min(1).max(280),
        })).min(1).max(20),
      }),
      execute: async ({ items }) => {
        const now = Date.now();
        // Persist through Agent.setState (via updateTodo) so the
        // DO storage layer captures it. Direct ctx.state mutation
        // is a no-op across hibernation.
        await ctx.updateTodo(items.map(i => ({
          id: i.id,
          title: i.title,
          status: "pending" as const,
          createdAt: now,
        })));
        return { ok: true, count: items.length };
      },
    }),

    mark_todo_done: tool({
      description: "Mark a single todo item as completed by its id.",
      inputSchema: z.object({ id: z.string().min(1) }),
      execute: async ({ id }) => {
        const next = ctx.state.todoList.map(t =>
          t.id === id
            ? { ...t, status: "completed" as const, completedAt: Date.now() }
            : t,
        );
        if (!next.some(t => t.id === id)) {
          throw new Error(`todo id not found: ${id}`);
        }
        await ctx.updateTodo(next);
        return { ok: true };
      },
    }),
  };
}

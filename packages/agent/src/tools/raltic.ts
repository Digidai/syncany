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
        "Semantic search over message history of channels this agent is a member of. Returns top-K matches with content preview, channel, sender, and timestamp. Use when the user references past discussion ('find that thread about X', 'what did we decide on Y'). Optional filters: channelId narrows to one channel; sinceTs/untilTs bound by createdAt (unix ms).",
      inputSchema: z.object({
        query: z.string().min(1).max(1024),
        limit: z.number().int().positive().max(50).default(10),
        channelId: z.string().min(1).optional(),
        sinceTs: z.number().int().nonnegative().optional(),
        untilTs: z.number().int().nonnegative().optional(),
      }),
      execute: async ({ query, limit, channelId, sinceTs, untilTs }) => {
        if (!ctx.env.AI || !ctx.env.VECTORIZE) {
          return { matches: [], error: "AI / Vectorize bindings not configured" };
        }
        // Permission: only channels this agent is a member of. Done
        // FIRST as a hard gate — Vectorize metadata filter narrows the
        // search to the same set, and the D1 hydration step re-checks
        // (defense in depth). If a caller passes channelId, we
        // intersect: an agent can only narrow within its own ACL.
        const allowed = await agentChannelIds(ctx);
        if (allowed.length === 0) return { matches: [] };
        let searchScope = allowed;
        if (channelId) {
          if (!allowed.includes(channelId)) {
            // Don't leak whether the channel exists — same response as
            // "no matches" so a prompt-injected agent can't enumerate
            // channels by binary-searching for non-empty results.
            return { matches: [] };
          }
          searchScope = [channelId];
        }
        // bge-m3 — multilingual (CJK), 1024 dim. Matches raltic-messages-v2
        // index dimensions. If this changes, also update:
        //   - packages/chat-room/src/chat-room.ts indexMessageBatch
        //   - apps/api/src/scheduled.ts runVectorizeBackfill
        //   - apps/api/wrangler.jsonc vectorize binding index_name
        const emb = await ctx.env.AI.run(
          "@cf/baai/bge-m3" as never,
          { text: [query] } as never,
        ) as unknown as { data: number[][] };
        const vec = emb.data[0];
        if (!vec) return { matches: [] };

        // Vectorize metadata filter — pre-filter using $in on channelId
        // and optional ts range. Cheaper than post-filtering thousands
        // of irrelevant matches.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filter: Record<string, any> = { channelId: { $in: searchScope } };
        if (sinceTs !== undefined || untilTs !== undefined) {
          const tsFilter: Record<string, number> = {};
          if (sinceTs !== undefined) tsFilter.$gte = sinceTs;
          if (untilTs !== undefined) tsFilter.$lte = untilTs;
          filter.ts = tsFilter;
        }
        const matches = await ctx.env.VECTORIZE.query(vec, {
          topK: Math.min(limit, 50),
          filter,
          returnMetadata: "indexed",   // small payloads — we hydrate body from D1
        });
        if (matches.matches.length === 0) return { matches: [] };

        // Hydrate from D1. Re-apply allowed-channel constraint as
        // belt-and-suspenders: if Vectorize ever leaks across the
        // metadata filter (bug, replication lag) we still don't return
        // unauthorized rows.
        const db = drizzle(ctx.env.DB);
        const rows = await db.select({
          id: messages.id,
          channelId: messages.channelId,
          senderId: messages.senderId,
          senderType: messages.senderType,
          content: messages.content,
          createdAt: messages.createdAt,
        }).from(messages).where(and(
          inArray(messages.id, matches.matches.map(m => m.id)),
          inArray(messages.channelId, allowed),
        ));

        // Preserve Vectorize's relevance order, since D1 returns by
        // insertion order. Map id -> score so we can sort.
        const scoreById = new Map(matches.matches.map(m => [m.id, m.score]));
        const ordered = rows
          .map(r => ({ row: r, score: scoreById.get(r.id) ?? 0 }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        return {
          matches: ordered.map(({ row, score }) => ({
            messageId: row.id,
            channelId: row.channelId,
            senderId: row.senderId,
            senderType: row.senderType,
            score,
            preview: row.content.slice(0, 240),
            createdAt: row.createdAt,
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

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@raltic/auth-core";
import { searchQuery } from "@raltic/protocol";
import { channelMembers, channels, messages } from "@raltic/db";
import { and, desc, eq, inArray, sql as sqlFn } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";

export const searchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/search?q=…  — simple LIKE search across messages user can read
// ---------------------------------------------------------------------------
searchRoutes.get("/api/v1/search", requireAuth, async (c) => {
  const q = searchQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  const conds = [
    sqlFn`${messages.content} LIKE ${'%' + q.q + '%'} COLLATE NOCASE`,
  ];
  if (q.channelId) {
    const ctx = ctxFor(c);
    await requirePolicy(policy.channels.canRead(ctx, q.channelId));
    conds.push(eq(messages.channelId, q.channelId));
  } else {
    // Limit to channels the user is a member of. For machine subjects,
    // additionally constrain to the key's own server so a key for serverA
    // can't search messages on serverB even if the user is in both.
    const memberConds = [eq(channelMembers.memberId, subject.userId)];
    const myChannels = subject.kind === "machine"
      ? await db
          .select({ id: channelMembers.channelId })
          .from(channelMembers)
          .innerJoin(channels, eq(channels.id, channelMembers.channelId))
          .where(and(...memberConds, eq(channels.serverId, subject.serverId)))
      : await db
          .select({ id: channelMembers.channelId })
          .from(channelMembers)
          .where(and(...memberConds));
    const ids = myChannels.map(r => r.id);
    if (ids.length === 0) return c.json({ messages: [] });
    conds.push(inArray(messages.channelId, ids));
  }
  const rows = await db.select().from(messages).where(and(...conds))
    .orderBy(desc(messages.createdAt))
    .limit(q.limit);
  return c.json({ messages: rows });
});

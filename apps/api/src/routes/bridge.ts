import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { resolveMachineKey, signWsToken } from "@syncany/auth-core";
import { bridgeConnectRequest } from "@syncany/protocol";
import { agents, channels, channelMembers } from "@syncany/db";
import { eq } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { rateLimit, clientIp } from "../lib/rate-limit";

export const bridgeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Bridge auth: trade machine key for ws token + bootstrap data
// ---------------------------------------------------------------------------
bridgeRoutes.post("/api/v1/bridge/connect", async (c) => {
  const limited = await rateLimit(c, "bridge_connect", clientIp(c), 60, 60); // 60/min/IP
  if (limited) return limited;
  const body = bridgeConnectRequest.parse(await c.req.json());
  const mk = await resolveMachineKey(c.env, body.apiKey);
  if (!mk) return c.json({ error: { code: "BAD_KEY", message: "invalid api key" } }, 401);

  const db = drizzle(c.env.DB);
  const [myAgents, myChannels] = await Promise.all([
    db.select().from(agents).where(eq(agents.ownerId, mk.userId)),
    db.select({ ch: channels, agentId: channelMembers.memberId })
      .from(channels)
      .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
      .innerJoin(agents, eq(agents.id, channelMembers.memberId))
      .where(eq(agents.ownerId, mk.userId)),
  ]);

  type ChannelType = typeof channels.$inferSelect["type"];
  const channelMap = new Map<string, { id: string; name: string; type: ChannelType; agentIds: string[] }>();
  for (const row of myChannels) {
    const existing = channelMap.get(row.ch.id);
    if (existing) existing.agentIds.push(row.agentId);
    else channelMap.set(row.ch.id, { id: row.ch.id, name: row.ch.name, type: row.ch.type, agentIds: [row.agentId] });
  }

  const wsToken = await signWsToken(c.env.CHAT_ROOM_AUTH_SECRET, {
    sub: mk.userId,
    agents: myAgents.map(a => a.id),
    bridgeId: mk.id,
    ttlSeconds: 60 * 60 * 24 * 7,
  });

  return c.json({
    wsUrl: new URL(c.req.url).origin.replace(/^http/, "ws"),
    token: wsToken,
    userId: mk.userId,
    serverId: mk.serverId,
    agents: myAgents.map(a => ({
      id: a.id, name: a.name, displayName: a.displayName,
      systemPrompt: a.systemPrompt, model: a.model,
    })),
    channels: Array.from(channelMap.values()),
  });
});

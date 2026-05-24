import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@raltic/db/schema";
import { signWsToken } from "@raltic/auth-core";
import { env } from "cloudflare:test";
import app from "../src/index";
import { bridgeKey, db, request, seedAgent, seedServer, seedUser } from "./helpers";

async function connectBridge(apiKey: string): Promise<{ token: string; agents: Array<{ id: string }> }> {
  const res = await request(app as never, "https://test.local/api/v1/bridge/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  expect(res.status).toBe(200);
  return await res.json() as { token: string; agents: Array<{ id: string }> };
}

describe("GET /api/v1/agents", () => {
  it("scopes bridge tokens to their bound server and bridge-mode agents", async () => {
    const owner = await seedUser({ name: "Owner" });
    const serverA = await seedServer(owner);
    const serverB = await seedServer(owner);
    const bridgeAgent = await seedAgent(serverA, owner);
    const cloudAgent = await seedAgent(serverA, owner);
    const otherServerAgent = await seedAgent(serverB, owner);

    await db()
      .update(schema.agents)
      .set({ runtimeMode: "raltic", model: "claude-haiku-4-5" })
      .where(eq(schema.agents.id, cloudAgent.id));

    const key = await bridgeKey(owner, serverA);
    const connected = await connectBridge(key);
    expect(connected.agents.map((a) => a.id)).toEqual([bridgeAgent.id]);

    const res = await request(app as never, "https://test.local/api/v1/agents", {
      headers: { authorization: `Bearer sy_bridge_${connected.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { agents: Array<{ id: string }> };
    expect(body.agents.map((a) => a.id)).toEqual([bridgeAgent.id]);
    expect(body.agents.map((a) => a.id)).not.toContain(cloudAgent.id);
    expect(body.agents.map((a) => a.id)).not.toContain(otherServerAgent.id);
  });
});

describe("bearer token audience separation", () => {
  it("rejects a bridge JWT presented with the sy_api_ prefix", async () => {
    const owner = await seedUser({ name: "Owner" });
    const server = await seedServer(owner);
    const agent = await seedAgent(server, owner);
    const bridgeToken = await signWsToken(env.CHAT_ROOM_AUTH_SECRET, {
      sub: owner.id,
      aud: "bridge",
      bridgeId: "mk_test",
      serverId: server.id,
      agents: [agent.id],
      ttlSeconds: 60,
    });

    const res = await request(app as never, "https://test.local/api/v1/me/default-server", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer sy_api_${bridgeToken}`,
      },
      body: JSON.stringify({ serverId: server.id }),
    });
    expect(res.status).toBe(401);
  });
});

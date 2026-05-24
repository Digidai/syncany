import { describe, expect, it } from "vitest";
import app from "../src/index";
import { bridgeKey, request, seedAgent, seedChannel, seedServer, seedUser, userBearer } from "./helpers";

async function connectBridge(apiKey: string): Promise<{ token: string }> {
  const res = await request(app as never, "https://test.local/api/v1/bridge/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  expect(res.status).toBe(200);
  return await res.json() as { token: string };
}

describe("POST /api/v1/ws/token", () => {
  it("mints channel tokens for human sessions", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await request(app as never, "https://test.local/api/v1/ws/token", {
      method: "POST",
      headers: { authorization: await userBearer(owner), "content-type": "application/json" },
      body: JSON.stringify({ channelId: channel.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { token?: string; wsUrl?: string };
    expect(body.token).toEqual(expect.any(String));
    expect(body.wsUrl).toBe("wss://test.local");
  });

  it("rejects machine keys and bridge tokens for channel token minting", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    await seedAgent(srv, owner);
    const key = await bridgeKey(owner, srv);
    const bridge = await connectBridge(key);

    for (const authorization of [`Bearer ${key}`, `Bearer sy_bridge_${bridge.token}`]) {
      const res = await request(app as never, "https://test.local/api/v1/ws/token", {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ channelId: channel.id }),
      });
      expect(res.status).toBe(403);
      const body = await res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toBe("user session required");
    }
  });

  it("rejects machine keys and bridge tokens for gateway token minting", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    await seedAgent(srv, owner);
    const key = await bridgeKey(owner, srv);
    const bridge = await connectBridge(key);

    for (const authorization of [`Bearer ${key}`, `Bearer sy_bridge_${bridge.token}`]) {
      const res = await request(app as never, "https://test.local/api/v1/ws/token", {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ scope: "gateway" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toBe("user session required");
    }
  });
});

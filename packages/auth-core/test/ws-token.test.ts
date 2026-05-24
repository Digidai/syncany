import { describe, it, expect } from "vitest";
import { signWsToken, verifyWsToken } from "../src/ws-token";

const SECRET = "test-secret-not-used-anywhere-real";

describe("verifyWsToken", () => {
  it("accepts a token signed by signWsToken", async () => {
    const t = await signWsToken(SECRET, { sub: "u1", ttlSeconds: 60 });
    const claims = await verifyWsToken(t, SECRET);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("u1");
    expect(typeof claims!.jti).toBe("string");
  });

  it("rejects a token signed with a different secret", async () => {
    const t = await signWsToken(SECRET, { sub: "u1", ttlSeconds: 60 });
    expect(await verifyWsToken(t, "wrong-secret")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const t = await signWsToken(SECRET, { sub: "u1", ttlSeconds: -1 });
    expect(await verifyWsToken(t, SECRET)).toBeNull();
  });

  it("rejects a malformed token", async () => {
    expect(await verifyWsToken("not.a.token", SECRET)).toBeNull();
    expect(await verifyWsToken("only.twoparts", SECRET)).toBeNull();
    expect(await verifyWsToken("", SECRET)).toBeNull();
  });

  it("rejects alg=none (alg-confusion attack)", async () => {
    // Manually craft a JWT with alg=none using a real signature shape.
    const headerB64 = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = { sub: "attacker", exp: Math.floor(Date.now() / 1000) + 60, iat: Math.floor(Date.now() / 1000) };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const evil = `${headerB64}.${payloadB64}.`;
    expect(await verifyWsToken(evil, SECRET)).toBeNull();
  });

  it("rejects a tampered payload (sig still valid for original)", async () => {
    const t = await signWsToken(SECRET, { sub: "u1", ttlSeconds: 60 });
    const [h, , s] = t.split(".");
    const tampered = JSON.stringify({ sub: "u2", exp: Math.floor(Date.now() / 1000) + 60, iat: 0 });
    const newPayloadB64 = Buffer.from(tampered).toString("base64url");
    expect(await verifyWsToken(`${h}.${newPayloadB64}.${s}`, SECRET)).toBeNull();
  });

  it("preserves audience, bridgeId, agents, channelId in payload", async () => {
    const t = await signWsToken(SECRET, {
      sub: "u1",
      aud: "bridge",
      agents: ["a1", "a2"],
      channelId: "c1",
      bridgeId: "b1",
      ttlSeconds: 60,
    });
    const claims = await verifyWsToken(t, SECRET);
    expect(claims).not.toBeNull();
    expect(claims!.aud).toBe("bridge");
    expect(claims!.agents).toEqual(["a1", "a2"]);
    expect(claims!.channelId).toBe("c1");
    expect(claims!.bridgeId).toBe("b1");
  });

  it("issues a unique jti per token by default", async () => {
    const t1 = await signWsToken(SECRET, { sub: "u1", ttlSeconds: 60 });
    const t2 = await signWsToken(SECRET, { sub: "u1", ttlSeconds: 60 });
    const c1 = await verifyWsToken(t1, SECRET);
    const c2 = await verifyWsToken(t2, SECRET);
    expect(c1!.jti).not.toBe(c2!.jti);
  });
});

import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  clientMessage,
  sendMessageRequest,
  detectedRuntimeSnapshot,
  encode,
} from "../src/index.js";

describe("@raltic/protocol smoke", () => {
  it("publishes PROTOCOL_VERSION = 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("encode() returns a JSON string", () => {
    const msg = encode({
      v: 1,
      t: "hello",
      id: "abc",
    });
    expect(typeof msg).toBe("string");
    expect(JSON.parse(msg)).toMatchObject({ t: "hello", id: "abc" });
  });

  it("clientMessage round-trips a valid hello", () => {
    const parsed = clientMessage.parse({
      v: 1,
      t: "hello",
      id: "id-1",
      agentIds: ["agent-1"],
    });
    expect(parsed.t).toBe("hello");
  });

  it("sendMessageRequest validates a known-good sample", () => {
    const parsed = sendMessageRequest.parse({
      channelId: "ch-1",
      content: "hi there",
      idempotencyKey: "k1",
    });
    expect(parsed.channelId).toBe("ch-1");
    expect(parsed.content).toBe("hi there");
  });

  it("detectedRuntimeSnapshot rejects an unknown runtime id", () => {
    expect(() =>
      detectedRuntimeSnapshot.parse({
        id: "bogus",
        detected: true,
        version: null,
        authed: null,
        authMethod: null,
        error: null,
      })
    ).toThrow();
  });
});

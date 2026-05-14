import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  env,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { signWsToken } from "@syncany/auth-core";
import type { ChatRoom } from "../src/chat-room";
import { applySchema, seedParents } from "./setup";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
    USER_GATEWAY: DurableObjectNamespace;
    DB: D1Database;
    CHAT_ROOM_AUTH_SECRET: string;
  }
}

const SECRET = "test-secret-do-not-use-in-prod";
const USER = "user_test_1";
const SERVER = "srv_test_1";
const CHANNEL = "chan_test_1";

beforeAll(async () => {
  await applySchema(env.DB);
  await seedParents(env.DB, { userId: USER, serverId: SERVER, channelId: CHANNEL });
});

function getStub() {
  return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(CHANNEL));
}

async function postInternalSend(content: string, idempotencyKey: string) {
  const stub = getStub();
  return stub.fetch("https://chat-room/internal/send", {
    method: "POST",
    headers: {
      "x-internal-secret": SECRET,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      channelId: CHANNEL,
      senderId: USER,
      senderType: "human",
      content,
      threadParentId: null,
      idempotencyKey,
    }),
  });
}

describe("ChatRoom DO - seq oracle", () => {
  it("allocates monotonic sequence numbers", async () => {
    // Each test file gets a fresh DO id (test isolation), so seq starts at 0.
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName("seq-test-channel"));
    const send = async (key: string) => {
      const r = await stub.fetch("https://chat-room/internal/send", {
        method: "POST",
        headers: { "x-internal-secret": SECRET, "content-type": "application/json" },
        body: JSON.stringify({
          channelId: "seq-test-channel",
          senderId: USER,
          senderType: "human",
          content: "hello",
          threadParentId: null,
          idempotencyKey: key,
        }),
      });
      return r.json() as Promise<{ ok: boolean; seq: number }>;
    };
    const a = await send("k1");
    const b = await send("k2");
    const c = await send("k3");
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(c.seq).toBe(3);
  });
});

describe("ChatRoom DO - idempotency", () => {
  it("returns the same seq for a repeated idempotencyKey, with deduped:true", async () => {
    const r1 = await postInternalSend("first", "dup-key-1").then((r) => r.json() as any);
    const r2 = await postInternalSend("first-retry", "dup-key-1").then((r) => r.json() as any);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.deduped).toBe(true);
    expect(r2.seq).toBe(r1.seq);
  });
});

describe("ChatRoom DO - alarm flushes pending_writes to D1", () => {
  it("buffered messages land in messages table after alarm runs", async () => {
    // Use a fresh channel id so the FK row exists but the messages table is empty.
    const flushChan = "chan_flush_1";
    await seedParents(env.DB, {
      userId: "user_flush_1",
      serverId: "srv_flush_1",
      channelId: flushChan,
    });

    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(flushChan));
    await stub.fetch("https://chat-room/internal/send", {
      method: "POST",
      headers: { "x-internal-secret": SECRET, "content-type": "application/json" },
      body: JSON.stringify({
        channelId: flushChan,
        senderId: "user_flush_1",
        senderType: "human",
        content: "should-flush",
        threadParentId: null,
        idempotencyKey: "flush-1",
      }),
    });

    // Force the alarm immediately (instead of waiting 250ms).
    await runDurableObjectAlarm(stub);

    const rows = await env.DB
      .prepare(`SELECT id, content, seq FROM messages WHERE channel_id = ? ORDER BY seq`)
      .bind(flushChan)
      .all();
    expect(rows.results.length).toBe(1);
    const row = rows.results[0] as { content: string; seq: number };
    expect(row.content).toBe("should-flush");
    expect(row.seq).toBe(1);
  });
});

describe("ChatRoom DO - handleNotify", () => {
  it("rejects calls without the shared secret", async () => {
    const stub = getStub();
    const res = await stub.fetch("https://chat-room/internal/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 1, t: "reaction", messageId: "x", emoji: ":+1:", reactorId: USER, added: true }),
    });
    expect(res.status).toBe(403);
  });

  it("accepts and broadcasts when secret is correct", async () => {
    const stub = getStub();
    const res = await stub.fetch("https://chat-room/internal/notify", {
      method: "POST",
      headers: { "x-internal-secret": SECRET, "content-type": "application/json" },
      body: JSON.stringify({ v: 1, t: "reaction", messageId: "x", emoji: ":+1:", reactorId: USER, added: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("ChatRoom DO - WebSocket upgrade auth", () => {
  it("rejects an upgrade without a token", async () => {
    const stub = getStub();
    const res = await stub.fetch(`https://chat-room/ws?channelId=${CHANNEL}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects an upgrade with a token signed by a different secret", async () => {
    const badToken = await signWsToken("WRONG_SECRET", {
      sub: USER, channelId: CHANNEL, ttlSeconds: 60,
    });
    const stub = getStub();
    const res = await stub.fetch(`https://chat-room/ws?channelId=${CHANNEL}`, {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": badToken,
      },
    });
    expect(res.status).toBe(401);
  });

  it("rejects when token's channelId does not match URL channelId", async () => {
    const token = await signWsToken(SECRET, {
      sub: USER, channelId: "OTHER_CHANNEL", ttlSeconds: 60,
    });
    const stub = getStub();
    const res = await stub.fetch(`https://chat-room/ws?channelId=${CHANNEL}`, {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": token,
      },
    });
    expect(res.status).toBe(403);
  });

  it("accepts a valid web-issued token (channelId matches)", async () => {
    const token = await signWsToken(SECRET, {
      sub: USER, channelId: CHANNEL, ttlSeconds: 60,
    });
    const stub = getStub();
    const res = await stub.fetch(`https://chat-room/ws?channelId=${CHANNEL}`, {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": token,
      },
    });
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeDefined();
  });

  it("accepts a bridge token (no channelId in claims) for any channel", async () => {
    const token = await signWsToken(SECRET, {
      sub: USER, agents: ["agent_1"], ttlSeconds: 60,
    });
    const stub = getStub();
    const res = await stub.fetch(`https://chat-room/ws?channelId=${CHANNEL}`, {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": token,
      },
    });
    expect(res.status).toBe(101);
  });
});

describe("ChatRoom DO - internal state", () => {
  it("persists nextSeq counter across DO restarts (via meta table)", async () => {
    const restartChan = "chan_restart_1";
    await seedParents(env.DB, {
      userId: "user_restart_1",
      serverId: "srv_restart_1",
      channelId: restartChan,
    });

    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(restartChan));

    // Send 2 messages, then check the counter via runInDurableObject.
    for (let i = 0; i < 2; i++) {
      await stub.fetch("https://chat-room/internal/send", {
        method: "POST",
        headers: { "x-internal-secret": SECRET, "content-type": "application/json" },
        body: JSON.stringify({
          channelId: restartChan,
          senderId: "user_restart_1",
          senderType: "human",
          content: `m${i}`,
          threadParentId: null,
          idempotencyKey: `r${i}`,
        }),
      });
    }

    const counter = await runInDurableObject(stub, async (instance, ctx) => {
      const row = ctx.storage.sql.exec(`SELECT value FROM meta WHERE key='next_seq'`).toArray()[0];
      return row ? Number(row.value) : 0;
    });
    expect(counter).toBe(2);
  });
});

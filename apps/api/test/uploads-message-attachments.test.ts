/**
 * Message attachment upload/download routes.
 *
 * Mirrors channels-members.test.ts style: route-level contract checks plus
 * narrow DB/R2 assertions for rows and objects these endpoints mutate.
 */
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { request, seedUser, seedServer, seedChannel, seedAgent, userBearer, bridgeKey } from "./helpers";
import { db } from "./helpers";
import * as schema from "@raltic/db/schema";
import { eq } from "drizzle-orm";
import app from "../src/index";

const SMALL_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]);
const OTHER_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6]);

type UploadOptions = {
  bytes?: Uint8Array;
  channelIdHeader?: string | null;
  filename?: string | null;
  contentType?: string;
  contentLength?: number | null;
};

async function joinAsMember(serverId: string, userId: string, role: "member" | "admin" = "member") {
  await db().insert(schema.serverMembers).values({
    serverId, memberId: userId, memberType: "human", role, joinedAt: new Date(),
  });
}

async function joinAgentChannel(channelId: string, agentId: string) {
  await db().insert(schema.channelMembers).values({
    channelId, memberId: agentId, memberType: "agent", joinedAt: new Date(), lastReadSeq: 0,
  });
}

function asBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function uploadAttachment(authBearer: string, channelId: string, opts: UploadOptions = {}) {
  const bytes = opts.bytes ?? SMALL_PNG;
  const headers: Record<string, string> = {
    authorization: authBearer,
    "content-type": opts.contentType ?? "image/png",
  };
  if (opts.channelIdHeader !== null) {
    headers["x-raltic-channel-id"] = opts.channelIdHeader ?? channelId;
  }
  if (opts.filename !== null) {
    headers["x-raltic-filename"] = opts.filename ?? "tiny.png";
  }
  if (opts.contentLength !== null) {
    headers["content-length"] = String(opts.contentLength ?? bytes.byteLength);
  }

  return request(app as never, "https://test.local/api/v1/uploads/message-attachment", {
    method: "POST",
    headers,
    body: asBody(bytes),
  });
}

async function getAttachment(authBearer: string | null, channelId: string, attachmentId: string) {
  const headers = authBearer ? { authorization: authBearer } : undefined;
  return request(app as never, `https://test.local/uploads/attachments/${channelId}/${attachmentId}`, {
    headers,
  });
}

async function sendMessage(
  authBearer: string,
  body: { channelId: string; content: string; attachmentIds?: string[] },
) {
  return request(app as never, "https://test.local/api/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authBearer },
    body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }),
  });
}

async function attachmentRow(id: string) {
  const rows = await db()
    .select()
    .from(schema.messageAttachments)
    .where(eq(schema.messageAttachments.id, id))
    .limit(1);
  return rows[0];
}

async function uploadAndReadBody(authBearer: string, channelId: string, bytes = SMALL_PNG) {
  const res = await uploadAttachment(authBearer, channelId, { bytes });
  expect(res.status).toBe(200);
  return await res.json() as {
    attachmentId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    url: string;
  };
}

async function seedLinkedMessage(channelId: string, senderId: string) {
  const id = crypto.randomUUID();
  const now = new Date();
  await db().insert(schema.messages).values({
    id,
    channelId,
    senderId,
    senderType: "human",
    content: "already linked",
    seq: 999_000,
    threadParentId: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function flushChannel(channelId: string) {
  const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(channelId));
  await runDurableObjectAlarm(stub);
}

describe("POST /api/v1/uploads/message-attachment", () => {
  it("lets a channel member upload a small PNG and records an unlinked row", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await uploadAttachment(await userBearer(owner), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      attachmentId: string;
      url: string;
      sizeBytes: number;
      filename: string;
      contentType: string;
    };
    expect(body.attachmentId).toMatch(/[0-9a-f-]{36}/);
    expect(body.url).toBe(`https://test.local/uploads/attachments/${channel.id}/${body.attachmentId}`);
    expect(body.sizeBytes).toBe(5);

    const row = await attachmentRow(body.attachmentId);
    expect(row).toMatchObject({
      id: body.attachmentId,
      messageId: null,
      channelId: channel.id,
      uploaderId: owner.id,
      r2Key: `attachments/${channel.id}/${body.attachmentId}`,
      filename: "tiny.png",
      contentType: "image/png",
      sizeBytes: 5,
    });

    const obj = await env.UPLOADS.get(row!.r2Key);
    expect(obj).not.toBeNull();
    expect(Array.from(new Uint8Array(await obj!.arrayBuffer()))).toEqual(Array.from(SMALL_PNG));
  });

  it("rejects machine-key bearers", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const key = await bridgeKey(owner, srv);

    const res = await uploadAttachment(`Bearer ${key}`, channel.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("user session required");
  });

  it("rejects a missing x-raltic-channel-id header", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await uploadAttachment(await userBearer(owner), channel.id, { channelIdHeader: null });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQ");
    expect(body.error.message).toBe("x-raltic-channel-id required");
  });

  it("rejects a missing x-raltic-filename header", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await uploadAttachment(await userBearer(owner), channel.id, { filename: null });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQ");
    expect(body.error.message).toBe("x-raltic-filename required");
  });

  it("rejects unsupported content-types", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await uploadAttachment(await userBearer(owner), channel.id, {
      contentType: "application/octet-stream",
    });
    expect(res.status).toBe(415);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_TYPE");
    expect(body.error.message).toBe("unsupported content-type");
  });

  it("rejects missing and zero content-length", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);

    const missing = await uploadAttachment(bearer, channel.id, { contentLength: null });
    expect(missing.status).toBe(411);
    const missingBody = await missing.json() as { error: { code: string; message: string } };
    expect(missingBody.error.code).toBe("BAD_REQ");
    expect(missingBody.error.message).toBe("content-length required");

    const zero = await uploadAttachment(bearer, channel.id, {
      bytes: new Uint8Array(),
      contentLength: 0,
    });
    expect(zero.status).toBe(411);
    const zeroBody = await zero.json() as { error: { code: string; message: string } };
    expect(zeroBody.error.code).toBe("BAD_REQ");
    expect(zeroBody.error.message).toBe("content-length required");
  });

  it("rejects a declared content-length over 25 MB", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await uploadAttachment(await userBearer(owner), channel.id, {
      contentLength: 25 * 1024 * 1024 + 1,
    });
    expect(res.status).toBe(413);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("TOO_LARGE");
    expect(body.error.message).toBe("max 25 MB per file");
  });

  it("rejects callers who are not channel members", async () => {
    const owner = await seedUser({ name: "Owner" });
    const caller = await seedUser({ name: "Caller" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, caller.id);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await uploadAttachment(await userBearer(caller), channel.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("forbidden");
  });

  it("rejects archived channels", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    await db().update(schema.channels)
      .set({ archivedAt: new Date(), archivedBy: owner.id })
      .where(eq(schema.channels.id, channel.id));

    const res = await uploadAttachment(await userBearer(owner), channel.id);
    expect(res.status).toBe(423);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("ARCHIVED");
    expect(body.error.message).toBe("channel is archived");
  });

  it("rejects uploads that would exceed the daily quota", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    await db().insert(schema.messageAttachments).values({
      id: crypto.randomUUID(),
      messageId: null,
      channelId: channel.id,
      uploaderId: owner.id,
      r2Key: "attachments/quota/prior",
      filename: "prior.png",
      contentType: "image/png",
      sizeBytes: 100 * 1024 * 1024 + 1,
      width: null,
      height: null,
      createdAt: new Date(),
    });

    const res = await uploadAttachment(await userBearer(owner), channel.id);
    expect(res.status).toBe(429);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("QUOTA_EXCEEDED");
    expect(body.error.message).toContain("daily 100 MB quota would be exceeded");
  });

  it("sanitizes path separators in filenames", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const body = await uploadAndReadBody(await userBearer(owner), channel.id, SMALL_PNG);
    expect(body.filename).toBe("tiny.png");

    const res = await uploadAttachment(await userBearer(owner), channel.id, {
      filename: "dir/sub\\tiny.png",
    });
    expect(res.status).toBe(200);
    const uploadBody = await res.json() as { attachmentId: string; filename: string };
    expect(uploadBody.filename).toBe("dir_sub_tiny.png");
    const row = await attachmentRow(uploadBody.attachmentId);
    expect(row?.filename).toBe("dir_sub_tiny.png");
  });

  it("decodes URL-encoded filenames from the client", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await uploadAttachment(await userBearer(owner), channel.id, {
      filename: "%E4%B8%AD",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { attachmentId: string; filename: string };
    expect(body.filename).toBe("\u4e2d");
    const row = await attachmentRow(body.attachmentId);
    expect(row?.filename).toBe("\u4e2d");
  });

  it("allows an agent owner who is not a human channel member per canAddMember semantics", async () => {
    const owner = await seedUser({ name: "Owner" });
    const agentOwner = await seedUser({ name: "Agent Owner" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, agentOwner.id);
    const agent = await seedAgent(srv, agentOwner);
    const channel = await seedChannel(srv, "private", [owner]);
    await joinAgentChannel(channel.id, agent.id);

    const res = await uploadAttachment(await userBearer(agentOwner), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { attachmentId: string };
    const row = await attachmentRow(body.attachmentId);
    expect(row).toMatchObject({
      channelId: channel.id,
      uploaderId: agentOwner.id,
      messageId: null,
    });
  });
});

describe("GET /uploads/attachments/:channelId/:attachmentId", () => {
  it("lets a channel member fetch their attachment bytes", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);
    const upload = await uploadAndReadBody(bearer, channel.id, OTHER_BYTES);

    const res = await getAttachment(bearer, channel.id, upload.attachmentId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(OTHER_BYTES));
  });

  it("rejects unauthenticated requests", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const upload = await uploadAndReadBody(await userBearer(owner), channel.id);

    const res = await getAttachment(null, channel.id, upload.attachmentId);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.message).toBe("sign in");
  });

  it("rejects non-members of the channel", async () => {
    const owner = await seedUser({ name: "Owner" });
    const caller = await seedUser({ name: "Caller" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, caller.id);
    const channel = await seedChannel(srv, "private", [owner]);
    const upload = await uploadAndReadBody(await userBearer(owner), channel.id);

    const res = await getAttachment(await userBearer(caller), channel.id, upload.attachmentId);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("forbidden");
  });

  it("returns 404 for the wrong channelId with the right attachmentId", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const otherChannel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);
    const upload = await uploadAndReadBody(bearer, channel.id);

    const res = await getAttachment(bearer, otherChannel.id, upload.attachmentId);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });

  it("returns 404 for an unknown attachmentId", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await getAttachment(await userBearer(owner), channel.id, crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });
});

describe("POST /api/v1/messages attachment link flow", () => {
  it("links uploaded attachments to the created message", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);
    const upload = await uploadAndReadBody(bearer, channel.id);

    const res = await sendMessage(bearer, {
      channelId: channel.id,
      content: "with attachment",
      attachmentIds: [upload.attachmentId],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: true; messageId: string };
    expect(body.ok).toBe(true);
    expect(body.messageId).toMatch(/[0-9a-f-]{36}/);

    const row = await attachmentRow(upload.attachmentId);
    expect(row?.messageId).toBe(body.messageId);
    await flushChannel(channel.id);
  });

  it("skips an attachment belonging to another user while creating the message", async () => {
    const owner = await seedUser({ name: "Owner" });
    const other = await seedUser({ name: "Other" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, other.id);
    const channel = await seedChannel(srv, "public", [owner, other]);
    const otherUpload = await uploadAndReadBody(await userBearer(other), channel.id);

    const res = await sendMessage(await userBearer(owner), {
      channelId: channel.id,
      content: "skip other user file",
      attachmentIds: [otherUpload.attachmentId],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: true; messageId: string };
    expect(body.ok).toBe(true);
    expect(body.messageId).toMatch(/[0-9a-f-]{36}/);

    const row = await attachmentRow(otherUpload.attachmentId);
    expect(row?.messageId).toBeNull();
    await flushChannel(channel.id);
  });

  it("skips an attachment from a different channel", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const otherChannel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);
    const otherUpload = await uploadAndReadBody(bearer, otherChannel.id);

    const res = await sendMessage(bearer, {
      channelId: channel.id,
      content: "skip other channel file",
      attachmentIds: [otherUpload.attachmentId],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: true; messageId: string };
    expect(body.ok).toBe(true);
    expect(body.messageId).toMatch(/[0-9a-f-]{36}/);

    const row = await attachmentRow(otherUpload.attachmentId);
    expect(row?.messageId).toBeNull();
    await flushChannel(channel.id);
  });

  it("skips an attachment already linked to another message", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);
    const upload = await uploadAndReadBody(bearer, channel.id);
    const linkedMessageId = await seedLinkedMessage(channel.id, owner.id);
    await db().update(schema.messageAttachments)
      .set({ messageId: linkedMessageId })
      .where(eq(schema.messageAttachments.id, upload.attachmentId));

    const res = await sendMessage(bearer, {
      channelId: channel.id,
      content: "skip linked file",
      attachmentIds: [upload.attachmentId],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: true; messageId: string };
    expect(body.ok).toBe(true);
    expect(body.messageId).toMatch(/[0-9a-f-]{36}/);

    const row = await attachmentRow(upload.attachmentId);
    expect(row?.messageId).toBe(linkedMessageId);
    await flushChannel(channel.id);
  });

  it("accepts an attachment-only message with empty content", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);
    const upload = await uploadAndReadBody(bearer, channel.id);

    const res = await sendMessage(bearer, {
      channelId: channel.id,
      content: "",
      attachmentIds: [upload.attachmentId],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: true; messageId: string };
    expect(body.ok).toBe(true);

    const row = await attachmentRow(upload.attachmentId);
    expect(row?.messageId).toBe(body.messageId);
    await flushChannel(channel.id);
  });

  it("rejects empty content with no attachments", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await sendMessage(await userBearer(owner), {
      channelId: channel.id,
      content: "",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as {
      error: { code: string; fields: Array<{ message: string }> };
    };
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.fields[0]?.message).toBe("message must have content or at least one attachment");
  });
});

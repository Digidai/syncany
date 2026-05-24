/**
 * Channel preferences + channel admin routes.
 *
 * Mirrors channels-members.test.ts: route-level contract checks plus narrow
 * DB assertions for the rows these endpoints mutate.
 */
import { describe, it, expect } from "vitest";
import { request, seedUser, seedServer, seedChannel, seedAgent, userBearer, bridgeKey } from "./helpers";
import { db } from "./helpers";
import * as schema from "@raltic/db/schema";
import { and, eq } from "drizzle-orm";
import app from "../src/index";

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

async function seedMessage(
  channelId: string,
  senderId: string,
  opts: Partial<{
    id: string;
    seq: number;
    content: string;
    senderType: "human" | "agent" | "system";
    threadParentId: string | null;
    editedAt: Date | null;
    deletedAt: Date | null;
  }> = {},
) {
  const id = opts.id ?? crypto.randomUUID();
  const now = new Date();
  await db().insert(schema.messages).values({
    id,
    channelId,
    senderId,
    senderType: opts.senderType ?? "human",
    content: opts.content ?? `message-${id.slice(0, 6)}`,
    seq: opts.seq ?? 1,
    threadParentId: opts.threadParentId ?? null,
    createdAt: now,
    updatedAt: now,
    editedAt: opts.editedAt ?? null,
    deletedAt: opts.deletedAt ?? null,
    vectorIndexedAt: null,
    pinnedAt: null,
    pinnedBy: null,
  });
  return { id, channelId, senderId };
}

async function pinMessage(authBearer: string, messageId: string) {
  return request(app as never, `https://test.local/api/v1/messages/${messageId}/pin`, {
    method: "POST",
    headers: { authorization: authBearer },
  });
}

async function unpinMessage(authBearer: string, messageId: string) {
  return request(app as never, `https://test.local/api/v1/messages/${messageId}/pin`, {
    method: "DELETE",
    headers: { authorization: authBearer },
  });
}

async function muteChannel(authBearer: string, channelId: string) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}/mute`, {
    method: "POST",
    headers: { authorization: authBearer },
  });
}

async function unmuteChannel(authBearer: string, channelId: string) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}/mute`, {
    method: "DELETE",
    headers: { authorization: authBearer },
  });
}

async function starChannel(authBearer: string, channelId: string) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}/star`, {
    method: "POST",
    headers: { authorization: authBearer },
  });
}

async function unstarChannel(authBearer: string, channelId: string) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}/star`, {
    method: "DELETE",
    headers: { authorization: authBearer },
  });
}

async function patchChannel(authBearer: string, channelId: string, body: unknown) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: authBearer },
    body: JSON.stringify(body),
  });
}

async function patchVisibility(authBearer: string, channelId: string, type: "public" | "private") {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}/visibility`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: authBearer },
    body: JSON.stringify({ type }),
  });
}

async function archiveChannel(authBearer: string, channelId: string) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}/archive`, {
    method: "POST",
    headers: { authorization: authBearer },
  });
}

async function unarchiveChannel(authBearer: string, channelId: string) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}/unarchive`, {
    method: "POST",
    headers: { authorization: authBearer },
  });
}

async function getChannel(authBearer: string, channelId: string) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}`, {
    headers: { authorization: authBearer },
  });
}

async function markRead(authBearer: string, channelId: string, lastReadSeq = 1) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}/read`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authBearer },
    body: JSON.stringify({ seq: lastReadSeq }),
  });
}

async function browseChannels(authBearer: string, serverId: string) {
  return request(app as never, `https://test.local/api/v1/servers/${serverId}/channels/browse`, {
    headers: { authorization: authBearer },
  });
}

async function connectBridge(apiKey: string): Promise<{ token: string }> {
  const res = await request(app as never, "https://test.local/api/v1/bridge/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  expect(res.status).toBe(200);
  return await res.json() as { token: string };
}

async function sendMessage(authBearer: string, channelId: string, content = "hello") {
  return request(app as never, "https://test.local/api/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authBearer },
    body: JSON.stringify({ channelId, content, idempotencyKey: crypto.randomUUID() }),
  });
}

async function messageRow(messageId: string) {
  const rows = await db().select().from(schema.messages).where(eq(schema.messages.id, messageId)).limit(1);
  return rows[0];
}

async function channelRow(channelId: string) {
  const rows = await db().select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
  return rows[0];
}

async function humanChannelMember(channelId: string, userId: string) {
  const rows = await db().select().from(schema.channelMembers).where(and(
    eq(schema.channelMembers.channelId, channelId),
    eq(schema.channelMembers.memberId, userId),
    eq(schema.channelMembers.memberType, "human"),
  )).limit(1);
  return rows[0];
}

async function channelMemberships(channelId: string) {
  return db()
    .select({ memberId: schema.channelMembers.memberId, memberType: schema.channelMembers.memberType })
    .from(schema.channelMembers)
    .where(eq(schema.channelMembers.channelId, channelId));
}

function membershipKey(rows: Array<{ memberId: string; memberType: string }>) {
  return rows.map((r) => `${r.memberType}:${r.memberId}`).sort();
}

describe("human-only channel surfaces", () => {
  it("rejects machine keys and bridge tokens for mark-read and public browse", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    await seedMessage(channel.id, owner.id, { seq: 1 });
    await seedAgent(srv, owner);
    const key = await bridgeKey(owner, srv);
    const { token } = await connectBridge(key);

    for (const authorization of [`Bearer ${key}`, `Bearer sy_bridge_${token}`]) {
      const mark = await markRead(authorization, channel.id, 1);
      expect(mark.status).toBe(403);
      const markBody = await mark.json() as { error: { code: string; message: string } };
      expect(markBody.error.code).toBe("FORBIDDEN");
      expect(markBody.error.message).toBe("user session required");

      const browse = await browseChannels(authorization, srv.id);
      expect(browse.status).toBe(403);
      const browseBody = await browse.json() as { error: { code: string; message: string } };
      expect(browseBody.error.code).toBe("FORBIDDEN");
      expect(browseBody.error.message).toBe("user session required");
    }

    const membership = await humanChannelMember(channel.id, owner.id);
    expect(membership?.lastReadSeq).toBe(0);
  });
});

describe("POST/DELETE /api/v1/messages/:id/pin", () => {
  it("lets any channel member pin and unpin a message", async () => {
    const owner = await seedUser({ name: "Owner" });
    const member = await seedUser({ name: "Member" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, member.id);
    const channel = await seedChannel(srv, "public", [owner, member]);
    const message = await seedMessage(channel.id, owner.id);

    const pin = await pinMessage(await userBearer(member), message.id);
    expect(pin.status).toBe(200);
    const pinBody = await pin.json() as { ok: boolean; pinnedAt: number };
    expect(pinBody.ok).toBe(true);
    expect(typeof pinBody.pinnedAt).toBe("number");
    expect(pinBody.pinnedAt).toBeGreaterThan(0);
    const pinned = await messageRow(message.id);
    expect(pinned?.pinnedBy).toBe(member.id);
    expect(pinned?.pinnedAt?.getTime()).toBe(pinBody.pinnedAt);

    const unpin = await unpinMessage(await userBearer(owner), message.id);
    expect(unpin.status).toBe(200);
    const unpinBody = await unpin.json() as { ok: boolean; alreadyUnpinned?: boolean };
    expect(unpinBody.ok).toBe(true);
    expect(unpinBody.alreadyUnpinned).toBeUndefined();
    const cleared = await messageRow(message.id);
    expect(cleared?.pinnedAt).toBeNull();
    expect(cleared?.pinnedBy).toBeNull();
  });

  it("rejects machine-key bearers", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const message = await seedMessage(channel.id, owner.id);
    const key = await bridgeKey(owner, srv);

    const pin = await pinMessage(`Bearer ${key}`, message.id);
    expect(pin.status).toBe(403);
    const pinBody = await pin.json() as { error: { code: string; message: string } };
    expect(pinBody.error.code).toBe("FORBIDDEN");
    expect(pinBody.error.message).toBe("user session required");

    const unpin = await unpinMessage(`Bearer ${key}`, message.id);
    expect(unpin.status).toBe(403);
    const unpinBody = await unpin.json() as { error: { code: string; message: string } };
    expect(unpinBody.error.code).toBe("FORBIDDEN");
    expect(unpinBody.error.message).toBe("user session required");
  });

  it("rejects a server member who has not joined the channel", async () => {
    const owner = await seedUser({ name: "Owner" });
    const reader = await seedUser({ name: "Reader" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, reader.id);
    const channel = await seedChannel(srv, "public", [owner]);
    const message = await seedMessage(channel.id, owner.id);

    const res = await pinMessage(await userBearer(reader), message.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("forbidden");
    const row = await messageRow(message.id);
    expect(row?.pinnedAt).toBeNull();
    expect(row?.pinnedBy).toBeNull();
  });

  it("returns alreadyUnpinned=true when the message is not pinned", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const message = await seedMessage(channel.id, owner.id);

    const res = await unpinMessage(await userBearer(owner), message.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; alreadyUnpinned: boolean };
    expect(body).toEqual({ ok: true, alreadyUnpinned: true });
  });

  it("allows pinning edited and deleted messages", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const editedAt = new Date(Date.now() - 60_000);
    const deletedAt = new Date(Date.now() - 30_000);
    const edited = await seedMessage(channel.id, owner.id, { seq: 1, editedAt });
    const deleted = await seedMessage(channel.id, owner.id, {
      seq: 2,
      content: "_(deleted)_",
      deletedAt,
    });
    const bearer = await userBearer(owner);

    const editedPin = await pinMessage(bearer, edited.id);
    expect(editedPin.status).toBe(200);
    const deletedPin = await pinMessage(bearer, deleted.id);
    expect(deletedPin.status).toBe(200);

    expect((await messageRow(edited.id))?.pinnedAt).toBeInstanceOf(Date);
    expect((await messageRow(deleted.id))?.pinnedAt).toBeInstanceOf(Date);
  });
});

describe("POST/DELETE /api/v1/channels/:id/mute", () => {
  it("lets a human member mute their own channel and persists mutedAt", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await muteChannel(await userBearer(owner), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; mutedAt: number };
    expect(body.ok).toBe(true);
    expect(body.mutedAt).toBeGreaterThan(0);
    const membership = await humanChannelMember(channel.id, owner.id);
    expect(membership?.mutedAt?.getTime()).toBe(body.mutedAt);
  });

  it("returns NOT_MEMBER for an agent-only owner instead of silently no-oping", async () => {
    const owner = await seedUser({ name: "Owner" });
    const agentOwner = await seedUser({ name: "Agent Owner" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, agentOwner.id);
    const agent = await seedAgent(srv, agentOwner);
    const channel = await seedChannel(srv, "private", [owner]);
    await joinAgentChannel(channel.id, agent.id);

    const res = await muteChannel(await userBearer(agentOwner), channel.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_MEMBER");
    expect(body.error.message).toBe("join the channel before muting it");
  });

  it("rejects machine-key bearers", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const key = await bridgeKey(owner, srv);

    const res = await muteChannel(`Bearer ${key}`, channel.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("user session required");
  });

  it("refreshes mutedAt on an idempotent re-mute", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const oldMutedAt = new Date(1);
    await db().update(schema.channelMembers).set({ mutedAt: oldMutedAt }).where(and(
      eq(schema.channelMembers.channelId, channel.id),
      eq(schema.channelMembers.memberId, owner.id),
      eq(schema.channelMembers.memberType, "human"),
    ));

    const res = await muteChannel(await userBearer(owner), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { mutedAt: number };
    expect(body.mutedAt).toBeGreaterThan(oldMutedAt.getTime());
    const membership = await humanChannelMember(channel.id, owner.id);
    expect(membership?.mutedAt?.getTime()).toBe(body.mutedAt);
  });

  it("clears mutedAt on unmute", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);

    const mute = await muteChannel(bearer, channel.id);
    expect(mute.status).toBe(200);
    const unmute = await unmuteChannel(bearer, channel.id);
    expect(unmute.status).toBe(200);
    const membership = await humanChannelMember(channel.id, owner.id);
    expect(membership?.mutedAt).toBeNull();
  });

  it("allows muting DM channels", async () => {
    const owner = await seedUser({ name: "Owner" });
    const peer = await seedUser({ name: "Peer" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, peer.id);
    const dm = await seedChannel(srv, "dm", [owner, peer]);

    const res = await muteChannel(await userBearer(owner), dm.id);
    expect(res.status).toBe(200);
    const membership = await humanChannelMember(dm.id, owner.id);
    expect(membership?.mutedAt).toBeInstanceOf(Date);
  });
});

describe("POST/DELETE /api/v1/channels/:id/star", () => {
  it("lets a human member star their own channel and persists starredAt", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await starChannel(await userBearer(owner), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; starredAt: number };
    expect(body.ok).toBe(true);
    expect(body.starredAt).toBeGreaterThan(0);
    const membership = await humanChannelMember(channel.id, owner.id);
    expect(membership?.starredAt?.getTime()).toBe(body.starredAt);
  });

  it("returns NOT_MEMBER for non-members", async () => {
    const owner = await seedUser({ name: "Owner" });
    const caller = await seedUser({ name: "Caller" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, caller.id);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await starChannel(await userBearer(caller), channel.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_MEMBER");
    expect(body.error.message).toBe("join the channel before starring it");
  });

  it("rejects machine-key bearers", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const key = await bridgeKey(owner, srv);

    const res = await starChannel(`Bearer ${key}`, channel.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("user session required");
  });

  it("refreshes starredAt on an idempotent re-star", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const oldStarredAt = new Date(1);
    await db().update(schema.channelMembers).set({ starredAt: oldStarredAt }).where(and(
      eq(schema.channelMembers.channelId, channel.id),
      eq(schema.channelMembers.memberId, owner.id),
      eq(schema.channelMembers.memberType, "human"),
    ));

    const res = await starChannel(await userBearer(owner), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { starredAt: number };
    expect(body.starredAt).toBeGreaterThan(oldStarredAt.getTime());
    const membership = await humanChannelMember(channel.id, owner.id);
    expect(membership?.starredAt?.getTime()).toBe(body.starredAt);
  });

  it("clears starredAt on unstar", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);

    const star = await starChannel(bearer, channel.id);
    expect(star.status).toBe(200);
    const unstar = await unstarChannel(bearer, channel.id);
    expect(unstar.status).toBe(200);
    const membership = await humanChannelMember(channel.id, owner.id);
    expect(membership?.starredAt).toBeNull();
  });
});

describe("PATCH /api/v1/channels/:id topic", () => {
  it("lets the creator and workspace owner update topic", async () => {
    const owner = await seedUser({ name: "Owner" });
    const creator = await seedUser({ name: "Creator" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, creator.id);
    const channel = await seedChannel(srv, "public", [creator]);

    const creatorPatch = await patchChannel(await userBearer(creator), channel.id, {
      topic: "ship channel preferences",
    });
    expect(creatorPatch.status).toBe(200);
    expect((await channelRow(channel.id))?.topic).toBe("ship channel preferences");

    const ownerPatch = await patchChannel(await userBearer(owner), channel.id, {
      topic: "owner-updated focus",
    });
    expect(ownerPatch.status).toBe(200);
    expect((await channelRow(channel.id))?.topic).toBe("owner-updated focus");
  });

  it("rejects non-creator non-owner callers", async () => {
    const owner = await seedUser({ name: "Owner" });
    const member = await seedUser({ name: "Member" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, member.id);
    const channel = await seedChannel(srv, "public", [owner, member]);

    const res = await patchChannel(await userBearer(member), channel.id, {
      topic: "not allowed",
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("forbidden");
  });

  it("clears topic when null or empty string is sent", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);

    const set = await patchChannel(bearer, channel.id, { topic: "temporary focus" });
    expect(set.status).toBe(200);
    const clearNull = await patchChannel(bearer, channel.id, { topic: null });
    expect(clearNull.status).toBe(200);
    expect((await channelRow(channel.id))?.topic).toBeNull();

    const reset = await patchChannel(bearer, channel.id, { topic: "temporary focus" });
    expect(reset.status).toBe(200);
    const clearEmpty = await patchChannel(bearer, channel.id, { topic: "" });
    expect(clearEmpty.status).toBe(200);
    expect((await channelRow(channel.id))?.topic).toBe("");
  });

  it("enforces the 250 character topic limit", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await patchChannel(await userBearer(owner), channel.id, {
      topic: "x".repeat(251),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as {
      error: { code: string; fields: Array<{ path: string; message: string }> };
    };
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.fields[0]?.path).toBe("topic");
  });
});

describe("PATCH /api/v1/channels/:id/visibility", () => {
  it("converts public channels to private and preserves membership", async () => {
    const owner = await seedUser({ name: "Owner" });
    const member = await seedUser({ name: "Member" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, member.id);
    const channel = await seedChannel(srv, "public", [owner, member]);
    const before = membershipKey(await channelMemberships(channel.id));

    const res = await patchVisibility(await userBearer(owner), channel.id, "private");
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; type: string };
    expect(body).toEqual({ ok: true, type: "private" });
    expect((await channelRow(channel.id))?.type).toBe("private");
    expect(membershipKey(await channelMemberships(channel.id))).toEqual(before);
  });

  it("converts private channels back to public", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "private", [owner]);

    const res = await patchVisibility(await userBearer(owner), channel.id, "public");
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; type: string };
    expect(body).toEqual({ ok: true, type: "public" });
    expect((await channelRow(channel.id))?.type).toBe("public");
  });

  it("returns BAD_REQ when converting a DM", async () => {
    const owner = await seedUser({ name: "Owner" });
    const peer = await seedUser({ name: "Peer" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, peer.id);
    const dm = await seedChannel(srv, "dm", [owner, peer]);

    const res = await patchVisibility(await userBearer(owner), dm.id, "private");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQ");
    expect(body.error.message).toBe("cannot change visibility of a DM");
  });

  it("returns unchanged=true when the target type matches current type", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await patchVisibility(await userBearer(owner), channel.id, "public");
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; unchanged: boolean };
    expect(body).toEqual({ ok: true, unchanged: true });
  });

  it("rejects non-creator non-owner callers", async () => {
    const owner = await seedUser({ name: "Owner" });
    const member = await seedUser({ name: "Member" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, member.id);
    const channel = await seedChannel(srv, "public", [owner, member]);

    const res = await patchVisibility(await userBearer(member), channel.id, "private");
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("forbidden");
  });
});

describe("POST /api/v1/channels/:id/archive and /unarchive", () => {
  it("lets the creator archive a channel and persists audit fields", async () => {
    const creator = await seedUser({ name: "Creator" });
    const srv = await seedServer(creator);
    const channel = await seedChannel(srv, "public", [creator]);

    const res = await archiveChannel(await userBearer(creator), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    const row = await channelRow(channel.id);
    expect(row?.archivedAt).toBeInstanceOf(Date);
    expect(row?.archivedBy).toBe(creator.id);
  });

  it("returns alreadyArchived=true on a second archive", async () => {
    const creator = await seedUser({ name: "Creator" });
    const srv = await seedServer(creator);
    const channel = await seedChannel(srv, "public", [creator]);
    const bearer = await userBearer(creator);

    const first = await archiveChannel(bearer, channel.id);
    expect(first.status).toBe(200);
    const second = await archiveChannel(bearer, channel.id);
    expect(second.status).toBe(200);
    const body = await second.json() as { ok: boolean; alreadyArchived: boolean };
    expect(body).toEqual({ ok: true, alreadyArchived: true });
  });

  it("returns alreadyActive=true when unarchiving an active channel", async () => {
    const creator = await seedUser({ name: "Creator" });
    const srv = await seedServer(creator);
    const channel = await seedChannel(srv, "public", [creator]);

    const res = await unarchiveChannel(await userBearer(creator), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; alreadyActive: boolean };
    expect(body).toEqual({ ok: true, alreadyActive: true });
  });

  it("returns BAD_REQ when archiving a DM", async () => {
    const owner = await seedUser({ name: "Owner" });
    const peer = await seedUser({ name: "Peer" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, peer.id);
    const dm = await seedChannel(srv, "dm", [owner, peer]);

    const res = await archiveChannel(await userBearer(owner), dm.id);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQ");
    expect(body.error.message).toBe("cannot archive a DM");
  });

  it("rejects non-creator non-owner callers", async () => {
    const owner = await seedUser({ name: "Owner" });
    const member = await seedUser({ name: "Member" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, member.id);
    const channel = await seedChannel(srv, "public", [owner, member]);

    const res = await archiveChannel(await userBearer(member), channel.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("forbidden");
  });

  it("blocks REST message sends to archived channels with 423 ARCHIVED", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);

    const archived = await archiveChannel(bearer, channel.id);
    expect(archived.status).toBe(200);
    const res = await sendMessage(bearer, channel.id);
    expect(res.status).toBe(423);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("ARCHIVED");
    expect(body.error.message).toBe("channel is archived");
  });
});

describe("GET /api/v1/channels/:id preference fields", () => {
  it("returns viewer mutedAt/starredAt and scrubs other member preference fields", async () => {
    const owner = await seedUser({ name: "Owner" });
    const member = await seedUser({ name: "Member" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, member.id);
    const channel = await seedChannel(srv, "public", [owner, member]);
    const mutedAt = new Date(1_700_000_000_000);
    const starredAt = new Date(1_700_000_060_000);
    const otherMutedAt = new Date(1_700_000_120_000);
    const otherStarredAt = new Date(1_700_000_180_000);
    await db().update(schema.channelMembers).set({
      mutedAt,
      starredAt,
      lastReadSeq: 7,
    }).where(and(
      eq(schema.channelMembers.channelId, channel.id),
      eq(schema.channelMembers.memberId, owner.id),
      eq(schema.channelMembers.memberType, "human"),
    ));
    await db().update(schema.channelMembers).set({
      mutedAt: otherMutedAt,
      starredAt: otherStarredAt,
      lastReadSeq: 42,
    }).where(and(
      eq(schema.channelMembers.channelId, channel.id),
      eq(schema.channelMembers.memberId, member.id),
      eq(schema.channelMembers.memberType, "human"),
    ));

    const res = await getChannel(await userBearer(owner), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      channel: { mutedAt: number; starredAt: number };
      members: Array<Record<string, unknown> & { memberId: string; memberType: string; joinedAt: string }>;
      viewerCanManage: boolean;
      viewerCanAddMembers: boolean;
    };
    expect(body.channel.mutedAt).toBe(mutedAt.getTime());
    expect(body.channel.starredAt).toBe(starredAt.getTime());
    expect(body.viewerCanManage).toBe(true);
    expect(body.viewerCanAddMembers).toBe(true);

    const other = body.members.find((m) => m.memberId === member.id);
    expect(other).toBeTruthy();
    expect(other).toEqual(expect.objectContaining({
      memberId: member.id,
      memberType: "human",
      joinedAt: expect.any(String),
    }));
    expect(other).not.toHaveProperty("mutedAt");
    expect(other).not.toHaveProperty("starredAt");
    expect(other).not.toHaveProperty("lastReadSeq");
  });
});

describe("GET /api/v1/channels/:id/messages filters", () => {
  it("resolves message id prefixes and full thread slices for CLI thread targets", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const auth = await userBearer(owner);

    const root = await seedMessage(channel.id, owner.id, { seq: 1, content: "root" });
    const reply = await seedMessage(channel.id, owner.id, { seq: 2, content: "reply", threadParentId: root.id });
    const other = await seedMessage(channel.id, owner.id, { seq: 3, content: "other" });

    const byPrefix = await request(
      app as never,
      `https://test.local/api/v1/channels/${channel.id}/messages?messageIdPrefix=${reply.id.slice(0, 8)}`,
      { headers: { authorization: auth } },
    );
    expect(byPrefix.status).toBe(200);
    const prefixBody = await byPrefix.json() as { messages: Array<{ id: string }> };
    expect(prefixBody.messages.map((m) => m.id)).toEqual([reply.id]);

    const byThread = await request(
      app as never,
      `https://test.local/api/v1/channels/${channel.id}/messages?threadParentId=${encodeURIComponent(root.id)}&limit=10`,
      { headers: { authorization: auth } },
    );
    expect(byThread.status).toBe(200);
    const threadBody = await byThread.json() as { messages: Array<{ id: string }> };
    const threadIds = threadBody.messages.map((m) => m.id);
    expect(new Set(threadIds)).toEqual(new Set([reply.id, root.id]));
    expect(threadIds).not.toContain(other.id);
  });
});

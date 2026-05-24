/**
 * Channel member management routes.
 *
 * Mirrors dm.test.ts style: route-level contract checks plus narrow DB
 * assertions for the membership rows that these endpoints mutate.
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

async function addMembers(
  authBearer: string,
  channelId: string,
  body: { memberIds?: string[]; agentIds?: string[] },
) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}/members`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authBearer },
    body: JSON.stringify(body),
  });
}

async function removeMember(authBearer: string, channelId: string, type: string, memberId: string) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}/members/${type}/${memberId}`, {
    method: "DELETE",
    headers: { authorization: authBearer },
  });
}

async function leaveChannel(authBearer: string, channelId: string) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}/leave`, {
    method: "POST",
    headers: { authorization: authBearer },
  });
}

async function getChannel(authBearer: string, channelId: string) {
  return request(app as never, `https://test.local/api/v1/channels/${channelId}`, {
    headers: { authorization: authBearer },
  });
}

async function channelMemberships(channelId: string) {
  return db()
    .select({ memberId: schema.channelMembers.memberId, memberType: schema.channelMembers.memberType })
    .from(schema.channelMembers)
    .where(eq(schema.channelMembers.channelId, channelId));
}

async function hasChannelMembership(
  channelId: string,
  memberId: string,
  memberType: "human" | "agent",
): Promise<boolean> {
  const rows = await db()
    .select({ memberId: schema.channelMembers.memberId })
    .from(schema.channelMembers)
    .where(and(
      eq(schema.channelMembers.channelId, channelId),
      eq(schema.channelMembers.memberId, memberId),
      eq(schema.channelMembers.memberType, memberType),
    ))
    .limit(1);
  return rows.length > 0;
}

describe("POST /api/v1/channels/:id/members", () => {
  it("lets a workspace owner add a human and an agent in the same call", async () => {
    const owner = await seedUser({ name: "Owner" });
    const human = await seedUser({ name: "Human" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, human.id);
    const agent = await seedAgent(srv, owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await addMembers(await userBearer(owner), channel.id, {
      memberIds: [human.id],
      agentIds: [agent.id],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      added: { humans: number; agents: number };
      skipped: { humans: number; agents: number };
    };
    expect(body).toMatchObject({
      ok: true,
      added: { humans: 1, agents: 1 },
      skipped: { humans: 0, agents: 0 },
    });

    const rows = await channelMemberships(channel.id);
    expect(rows).toEqual(expect.arrayContaining([
      { memberId: owner.id, memberType: "human" },
      { memberId: human.id, memberType: "human" },
      { memberId: agent.id, memberType: "agent" },
    ]));
  });

  it("dedupes repeated ids in one call and reports later repeats as skipped", async () => {
    const owner = await seedUser({ name: "Owner" });
    const human = await seedUser({ name: "Human" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, human.id);
    const channel = await seedChannel(srv, "public", [owner]);
    const bearer = await userBearer(owner);

    const first = await addMembers(bearer, channel.id, { memberIds: [human.id, human.id] });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
      added: { humans: number; agents: number };
      skipped: { humans: number; agents: number };
    };
    expect(firstBody.added).toEqual({ humans: 1, agents: 0 });
    expect(firstBody.skipped).toEqual({ humans: 0, agents: 0 });

    const second = await addMembers(bearer, channel.id, { memberIds: [human.id] });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as {
      added: { humans: number; agents: number };
      skipped: { humans: number; agents: number };
    };
    expect(secondBody.added).toEqual({ humans: 0, agents: 0 });
    expect(secondBody.skipped).toEqual({ humans: 1, agents: 0 });

    const rows = await channelMemberships(channel.id);
    expect(rows.filter((r) => r.memberId === human.id)).toEqual([
      { memberId: human.id, memberType: "human" },
    ]);
  });

  it("treats an id present in both memberIds and agentIds as human-only", async () => {
    const owner = await seedUser({ name: "Owner" });
    const human = await seedUser({ name: "Human" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, human.id);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await addMembers(await userBearer(owner), channel.id, {
      memberIds: [human.id],
      agentIds: [human.id],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      added: { humans: number; agents: number };
      skipped: { humans: number; agents: number };
    };
    expect(body.added).toEqual({ humans: 1, agents: 0 });
    expect(body.skipped).toEqual({ humans: 0, agents: 0 });
    expect(await hasChannelMembership(channel.id, human.id, "human")).toBe(true);
    expect(await hasChannelMembership(channel.id, human.id, "agent")).toBe(false);
  });

  it("rejects an empty body", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await addMembers(await userBearer(owner), channel.id, {
      memberIds: [],
      agentIds: [],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as {
      error: { code: string; fields: Array<{ message: string }> };
    };
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.fields[0]?.message).toBe("must add at least one member or agent");
  });

  it("rejects a human from another workspace", async () => {
    const owner = await seedUser({ name: "Owner" });
    const outsider = await seedUser({ name: "Outsider" });
    const srv = await seedServer(owner);
    await seedServer(outsider);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await addMembers(await userBearer(owner), channel.id, {
      memberIds: [outsider.id],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQ");
    expect(body.error.message).toContain("not workspace members");
  });

  it("rejects an agent from another workspace", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const otherOwner = await seedUser({ name: "Other Owner" });
    const otherSrv = await seedServer(otherOwner);
    const otherAgent = await seedAgent(otherSrv, otherOwner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await addMembers(await userBearer(owner), channel.id, {
      agentIds: [otherAgent.id],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQ");
    expect(body.error.message).toContain("must belong to the same workspace");
  });

  it("returns 403 for a non-existent channel (existence-hiding)", async () => {
    // policy.canAddMember runs before the existence check; for a
    // missing channel id the gate fails (no membership row), which
    // 403s. This is intentional — leaking 404 vs 403 by channel id
    // would let any signed-in user enumerate channel ids across
    // workspaces.
    const owner = await seedUser({ name: "Owner" });
    await seedServer(owner);

    const res = await addMembers(await userBearer(owner), crypto.randomUUID(), {
      memberIds: [owner.id],
    });
    expect(res.status).toBe(403);
  });

  it("rejects adding members to a DM channel", async () => {
    const owner = await seedUser({ name: "Owner" });
    const peer = await seedUser({ name: "Peer" });
    const target = await seedUser({ name: "Target" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, peer.id);
    await joinAsMember(srv.id, target.id);
    const dm = await seedChannel(srv, "dm", [owner, peer]);

    const res = await addMembers(await userBearer(owner), dm.id, {
      memberIds: [target.id],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQ");
    expect(body.error.message).toBe("cannot add members to a DM");
  });

  it("rejects a caller who is not a channel member", async () => {
    const owner = await seedUser({ name: "Owner" });
    const caller = await seedUser({ name: "Caller" });
    const target = await seedUser({ name: "Target" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, caller.id);
    await joinAsMember(srv.id, target.id);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await addMembers(await userBearer(caller), channel.id, {
      memberIds: [target.id],
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("forbidden");
  });

  it("rejects machine-key bearers", async () => {
    const owner = await seedUser({ name: "Owner" });
    const target = await seedUser({ name: "Target" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, target.id);
    const channel = await seedChannel(srv, "public", [owner]);
    const key = await bridgeKey(owner, srv);

    const res = await addMembers(`Bearer ${key}`, channel.id, {
      memberIds: [target.id],
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("user session required");
  });
});

describe("DELETE /api/v1/channels/:id/members/:type/:memberId", () => {
  it("lets the creator remove a member", async () => {
    const creator = await seedUser({ name: "Creator" });
    const target = await seedUser({ name: "Target" });
    const srv = await seedServer(creator);
    await joinAsMember(srv.id, target.id);
    const channel = await seedChannel(srv, "public", [creator, target]);

    const res = await removeMember(await userBearer(creator), channel.id, "human", target.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; alreadyRemoved?: boolean };
    expect(body.ok).toBe(true);
    expect(body.alreadyRemoved).toBeUndefined();
    expect(await hasChannelMembership(channel.id, target.id, "human")).toBe(false);
  });

  it("lets a workspace owner who is not the creator remove a member", async () => {
    const owner = await seedUser({ name: "Owner" });
    const creator = await seedUser({ name: "Creator" });
    const target = await seedUser({ name: "Target" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, creator.id);
    await joinAsMember(srv.id, target.id);
    const channel = await seedChannel(srv, "public", [creator, target]);

    const res = await removeMember(await userBearer(owner), channel.id, "human", target.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(await hasChannelMembership(channel.id, target.id, "human")).toBe(false);
  });

  it("rejects an invalid member type", async () => {
    const owner = await seedUser({ name: "Owner" });
    const target = await seedUser({ name: "Target" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, target.id);
    const channel = await seedChannel(srv, "public", [owner, target]);

    const res = await removeMember(await userBearer(owner), channel.id, "bot", target.id);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQ");
    expect(body.error.message).toBe("type must be human or agent");
  });

  it("rejects self-removal and directs callers to /leave", async () => {
    const creator = await seedUser({ name: "Creator" });
    const srv = await seedServer(creator);
    const channel = await seedChannel(srv, "public", [creator]);

    const res = await removeMember(await userBearer(creator), channel.id, "human", creator.id);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQ");
    expect(body.error.message).toBe("use POST /leave to remove yourself");
  });

  it("returns alreadyRemoved=true when the target is not a channel member", async () => {
    const creator = await seedUser({ name: "Creator" });
    const target = await seedUser({ name: "Target" });
    const srv = await seedServer(creator);
    await joinAsMember(srv.id, target.id);
    const channel = await seedChannel(srv, "public", [creator]);

    const res = await removeMember(await userBearer(creator), channel.id, "human", target.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; alreadyRemoved: boolean };
    expect(body).toEqual({ ok: true, alreadyRemoved: true });
  });

  it("rejects a regular member trying to remove someone", async () => {
    const owner = await seedUser({ name: "Owner" });
    const regular = await seedUser({ name: "Regular" });
    const target = await seedUser({ name: "Target" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, regular.id);
    await joinAsMember(srv.id, target.id);
    const channel = await seedChannel(srv, "public", [owner, regular, target]);

    const res = await removeMember(await userBearer(regular), channel.id, "human", target.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("forbidden");
    expect(await hasChannelMembership(channel.id, target.id, "human")).toBe(true);
  });

  it("rejects removing members from a DM channel", async () => {
    const owner = await seedUser({ name: "Owner" });
    const peer = await seedUser({ name: "Peer" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, peer.id);
    const dm = await seedChannel(srv, "dm", [owner, peer]);

    const res = await removeMember(await userBearer(owner), dm.id, "human", peer.id);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQ");
    expect(body.error.message).toBe("cannot remove members from a DM");
  });

  it("returns 403 for a non-existent channel (existence-hiding)", async () => {
    // canRemoveMember = canUpdate runs before existence check; same
    // intentional 403 as POST /members above.
    const owner = await seedUser({ name: "Owner" });
    await seedServer(owner);

    const res = await removeMember(await userBearer(owner), crypto.randomUUID(), "human", owner.id);
    expect(res.status).toBe(403);
  });

  it("rejects machine-key bearers", async () => {
    const owner = await seedUser({ name: "Owner" });
    const target = await seedUser({ name: "Target" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, target.id);
    const channel = await seedChannel(srv, "public", [owner, target]);
    const key = await bridgeKey(owner, srv);

    const res = await removeMember(`Bearer ${key}`, channel.id, "human", target.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("user session required");
  });
});

describe("POST /api/v1/channels/:id/leave", () => {
  it("lets a member leave and subsequent fetch shows membership gone", async () => {
    const owner = await seedUser({ name: "Owner" });
    const member = await seedUser({ name: "Member" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, member.id);
    const channel = await seedChannel(srv, "public", [owner, member]);
    const bearer = await userBearer(member);

    const res = await leaveChannel(bearer, channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; alreadyLeft?: boolean };
    expect(body.ok).toBe(true);
    expect(body.alreadyLeft).toBeUndefined();
    expect(await hasChannelMembership(channel.id, member.id, "human")).toBe(false);

    const fetch = await getChannel(bearer, channel.id);
    expect(fetch.status).toBe(200);
    const fetchBody = await fetch.json() as {
      members: Array<{ memberId: string; memberType: "human" | "agent" }>;
    };
    expect(fetchBody.members.some((m) => m.memberType === "human" && m.memberId === member.id)).toBe(false);
  });

  it("returns alreadyLeft=true on a second leave call", async () => {
    const owner = await seedUser({ name: "Owner" });
    const member = await seedUser({ name: "Member" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, member.id);
    const channel = await seedChannel(srv, "public", [owner, member]);
    const bearer = await userBearer(member);

    const first = await leaveChannel(bearer, channel.id);
    expect(first.status).toBe(200);

    const second = await leaveChannel(bearer, channel.id);
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { ok: boolean; alreadyLeft: boolean };
    expect(secondBody).toEqual({ ok: true, alreadyLeft: true });
  });

  it("rejects leaving a DM channel", async () => {
    const owner = await seedUser({ name: "Owner" });
    const member = await seedUser({ name: "Member" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, member.id);
    const dm = await seedChannel(srv, "dm", [owner, member]);

    const res = await leaveChannel(await userBearer(member), dm.id);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQ");
    expect(body.error.message).toBe("cannot leave a DM");
  });

  it("returns 404 for a non-existent channel", async () => {
    const member = await seedUser({ name: "Member" });
    await seedServer(member);

    const res = await leaveChannel(await userBearer(member), crypto.randomUUID());
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("no such channel");
  });

  it("returns alreadyLeft=true for a non-member (idempotency precheck)", async () => {
    // Idempotency was intentionally moved before the canLeave gate
    // (fix in 9280feb) so a stale tab clicking Leave twice doesn't
    // 403 on the second click. Total outsiders also hit the same
    // happy alreadyLeft path — channel existence is already probeable
    // via /channels/:id, so this doesn't widen the leak surface.
    const owner = await seedUser({ name: "Owner" });
    const caller = await seedUser({ name: "Caller" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, caller.id);
    const channel = await seedChannel(srv, "private", [owner]);

    const res = await leaveChannel(await userBearer(caller), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: true; alreadyLeft: boolean };
    expect(body.ok).toBe(true);
    expect(body.alreadyLeft).toBe(true);
  });

  it("rejects machine-key bearers", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const key = await bridgeKey(owner, srv);

    const res = await leaveChannel(`Bearer ${key}`, channel.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("user session required");
  });
});

describe("GET /api/v1/channels/:id member-management flags", () => {
  it("sets viewerCanManage=true for the channel creator", async () => {
    const creator = await seedUser({ name: "Creator" });
    const srv = await seedServer(creator);
    const channel = await seedChannel(srv, "public", [creator]);

    const res = await getChannel(await userBearer(creator), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { viewerCanManage: boolean; viewerCanAddMembers: boolean };
    expect(body.viewerCanManage).toBe(true);
    expect(body.viewerCanAddMembers).toBe(true);
  });

  it("sets viewerCanManage=true for a workspace owner who is not the creator", async () => {
    const owner = await seedUser({ name: "Owner" });
    const creator = await seedUser({ name: "Creator" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, creator.id);
    const channel = await seedChannel(srv, "public", [creator]);

    const res = await getChannel(await userBearer(owner), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { viewerCanManage: boolean };
    expect(body.viewerCanManage).toBe(true);
  });

  it("sets viewerCanManage=false for an ordinary member", async () => {
    const owner = await seedUser({ name: "Owner" });
    const member = await seedUser({ name: "Member" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, member.id);
    const channel = await seedChannel(srv, "public", [owner, member]);

    const res = await getChannel(await userBearer(member), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { viewerCanManage: boolean };
    expect(body.viewerCanManage).toBe(false);
  });

  it("sets viewerCanAddMembers=true for an ordinary member", async () => {
    const owner = await seedUser({ name: "Owner" });
    const member = await seedUser({ name: "Member" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, member.id);
    const channel = await seedChannel(srv, "public", [owner, member]);

    const res = await getChannel(await userBearer(member), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as { viewerCanAddMembers: boolean };
    expect(body.viewerCanAddMembers).toBe(true);
  });

  it("sets viewerCanAddMembers=true via ownership of an agent in the channel", async () => {
    const owner = await seedUser({ name: "Owner" });
    const agentOwner = await seedUser({ name: "Agent Owner" });
    const srv = await seedServer(owner);
    await joinAsMember(srv.id, agentOwner.id);
    const agent = await seedAgent(srv, agentOwner);
    const channel = await seedChannel(srv, "private", [owner]);
    await joinAgentChannel(channel.id, agent.id);

    const res = await getChannel(await userBearer(agentOwner), channel.id);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      members: Array<{ memberId: string; memberType: "human" | "agent" }>;
      viewerCanManage: boolean;
      viewerCanAddMembers: boolean;
    };
    expect(body.members.some((m) => m.memberType === "human" && m.memberId === agentOwner.id)).toBe(false);
    expect(body.members.some((m) => m.memberType === "agent" && m.memberId === agent.id)).toBe(true);
    expect(body.viewerCanManage).toBe(false);
    expect(body.viewerCanAddMembers).toBe(true);
  });

  it("returns 403 for a total outsider instead of exposing add-member flags", async () => {
    const owner = await seedUser({ name: "Owner" });
    const outsider = await seedUser({ name: "Outsider" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);

    const res = await getChannel(await userBearer(outsider), channel.id);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("forbidden");
  });
});

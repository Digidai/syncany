/**
 * POST /api/v1/dm — find-or-create 1:1 DM channel.
 *
 * Exercises the public contract (idempotency, peer kinds, isolation)
 * plus the failure modes that matter for security (cross-workspace
 * peer, machine-key bearer, self-DM).
 */
import { describe, it, expect } from "vitest";
import { request, seedUser, seedServer, seedAgent, userBearer, bridgeKey } from "./helpers";
import { db } from "./helpers";
import * as schema from "@raltic/db/schema";
import { eq } from "drizzle-orm";
import app from "../src/index";

async function joinAsMember(serverId: string, userId: string) {
  await db().insert(schema.serverMembers).values({
    serverId, memberId: userId, memberType: "human", role: "member", joinedAt: new Date(),
  });
}

async function openDm(authBearer: string, body: { serverId: string; peerType: "human" | "agent"; peerId: string }) {
  return request(app as never, "https://test.local/api/v1/dm", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authBearer },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/dm", () => {
  it("creates a human↔human DM and is idempotent on the second call", async () => {
    const alice = await seedUser({ name: "Alice" });
    const bob = await seedUser({ name: "Bob" });
    const srv = await seedServer(alice);
    await joinAsMember(srv.id, bob.id);
    const bearer = await userBearer(alice);

    const first = await openDm(bearer, { serverId: srv.id, peerType: "human", peerId: bob.id });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { channelId: string; created: boolean };
    expect(firstBody.created).toBe(true);
    expect(firstBody.channelId).toMatch(/^[0-9a-f-]{36}$/);

    const second = await openDm(bearer, { serverId: srv.id, peerType: "human", peerId: bob.id });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { channelId: string; created: boolean };
    expect(secondBody.created).toBe(false);
    expect(secondBody.channelId).toBe(firstBody.channelId);
  });

  it("creates a human↔agent DM (auto-created by seedAgent), find-or-create is idempotent on re-open", async () => {
    const alice = await seedUser({ name: "Alice" });
    const srv = await seedServer(alice);
    // seedAgent already creates the DM channel + memberships, so the
    // first openDm call should return the EXISTING channel, not create
    // a new one. Both calls should return the same channelId.
    const agent = await seedAgent(srv, alice);
    const bearer = await userBearer(alice);

    const first = await openDm(bearer, { serverId: srv.id, peerType: "agent", peerId: agent.id });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { channelId: string; created: boolean };
    expect(firstBody.created).toBe(false);  // already exists from seedAgent
    expect(firstBody.channelId).toBe(agent.dmChannelId);

    const second = await openDm(bearer, { serverId: srv.id, peerType: "agent", peerId: agent.id });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { channelId: string; created: boolean };
    expect(secondBody.channelId).toBe(firstBody.channelId);
  });

  it("rejects self-DM", async () => {
    const alice = await seedUser();
    const srv = await seedServer(alice);
    const bearer = await userBearer(alice);
    const res = await openDm(bearer, { serverId: srv.id, peerType: "human", peerId: alice.id });
    expect(res.status).toBe(400);
  });

  it("rejects peer that is not a member of the workspace (404)", async () => {
    const alice = await seedUser();
    const stranger = await seedUser();
    const srv = await seedServer(alice);
    const bearer = await userBearer(alice);
    const res = await openDm(bearer, { serverId: srv.id, peerType: "human", peerId: stranger.id });
    expect(res.status).toBe(404);
  });

  it("rejects an agent that lives in a DIFFERENT workspace (404, cross-server isolation)", async () => {
    const alice = await seedUser();
    const aliceSrv = await seedServer(alice);
    const bob = await seedUser();
    const bobSrv = await seedServer(bob);
    const bobAgent = await seedAgent(bobSrv, bob);
    const bearer = await userBearer(alice);
    const res = await openDm(bearer, { serverId: aliceSrv.id, peerType: "agent", peerId: bobAgent.id });
    expect(res.status).toBe(404);
  });

  it("rejects unauthenticated callers (401)", async () => {
    const alice = await seedUser();
    const srv = await seedServer(alice);
    const res = await request(app as never, "https://test.local/api/v1/dm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serverId: srv.id, peerType: "human", peerId: alice.id }),
    });
    expect(res.status).toBe(401);
  });

  it("post-insert reconciliation prunes duplicate DMs for the same (me, peer)", async () => {
    // Regression for the loser-deletes resolution added after codex review
    // flagged the SELECT-then-INSERT race in /api/v1/dm. We can't reliably
    // reproduce true concurrency in the in-process workerd test isolate
    // (D1 serializes; vitest-pool-workers sees most racers fail-fast on
    // write-write conflict), so we directly simulate the post-race state:
    // two DM channels exist for the same pair, and a subsequent openDm
    // call must converge on the older one and delete the newer.
    const alice = await seedUser({ name: "Alice" });
    const bob = await seedUser({ name: "Bob" });
    const srv = await seedServer(alice);
    await joinAsMember(srv.id, bob.id);
    const bearer = await userBearer(alice);

    // Create the FIRST DM via the route, then forge a SECOND duplicate
    // directly in the DB — what a lost race would look like.
    const first = await openDm(bearer, { serverId: srv.id, peerType: "human", peerId: bob.id });
    const firstBody = await first.json() as { channelId: string };
    const dupChannelId = crypto.randomUUID();
    const later = new Date(Date.now() + 1000);  // newer createdAt → loser
    await db().insert(schema.channels).values({
      id: dupChannelId, serverId: srv.id, name: "dm-dup", type: "dm",
      createdBy: alice.id, createdAt: later,
    });
    await db().insert(schema.channelMembers).values([
      { channelId: dupChannelId, memberId: alice.id, memberType: "human", joinedAt: later },
      { channelId: dupChannelId, memberId: bob.id, memberType: "human", joinedAt: later },
    ]);

    // Now ask for the DM again — must return the ORIGINAL (older) and
    // prune the duplicate.
    const reopen = await openDm(bearer, { serverId: srv.id, peerType: "human", peerId: bob.id });
    expect(reopen.status).toBe(200);
    const reopenBody = await reopen.json() as { channelId: string; created: boolean };
    expect(reopenBody.channelId).toBe(firstBody.channelId);

    // The duplicate must be gone from the DB.
    const remaining = await db().select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.id, dupChannelId))
      .all();
    expect(remaining.length).toBe(0);
  });

  it("rejects machine-key bearers (403)", async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    const srv = await seedServer(alice);
    await joinAsMember(srv.id, bob.id);
    const key = await bridgeKey(alice, srv);
    const res = await request(app as never, "https://test.local/api/v1/dm", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ serverId: srv.id, peerType: "human", peerId: bob.id }),
    });
    expect(res.status).toBe(403);
  });
});

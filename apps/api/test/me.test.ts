/**
 * /me + PATCH /me/default-server + runOnboarding round-trip.
 *
 * Covers the contract introduced for the personal/default workspace
 * resolution chain (see apps/api/src/routes/me.ts):
 *   - servers[] carries role + stable sort (owner before member).
 *   - personalServerId/Slug = earliest owned workspace.
 *   - defaultServerId/Slug = user.default_server_id (or fallback to
 *     personal).
 *   - runOnboarding writes default_server_id to the personal workspace
 *     it creates.
 *   - PATCH /me/default-server gates: user-session only (no machine
 *     keys), serverId must be a workspace the caller can read.
 */
import { describe, it, expect } from "vitest";
import { request, seedUser, seedServer, userBearer, bridgeKey } from "./helpers";
import { db } from "./helpers";
import * as schema from "@raltic/db/schema";
import { runOnboarding } from "@raltic/auth-core";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import app from "../src/index";

async function joinAsMember(serverId: string, userId: string, role: "member" | "admin" = "member") {
  await db().insert(schema.serverMembers).values({
    serverId, memberId: userId, memberType: "human", role, joinedAt: new Date(),
  });
}

describe("GET /api/v1/me — shape + sort + personal/default resolution", () => {
  it("returns servers with role and stable sort (owner first, then admin, then member)", async () => {
    const user = await seedUser();
    const myOwn = await seedServer(user);  // role=owner
    const otherOwner = await seedUser();
    const memberSrv = await seedServer(otherOwner);
    const adminSrv = await seedServer(otherOwner);
    await joinAsMember(memberSrv.id, user.id, "member");
    await joinAsMember(adminSrv.id, user.id, "admin");

    const res = await request(app as never, "https://test.local/api/v1/me", {
      headers: { authorization: await userBearer(user) },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      servers: Array<{ id: string; role: string }>;
      personalServerId: string;
      personalServerSlug: string;
    };
    // Owner first.
    expect(body.servers[0]).toMatchObject({ id: myOwn.id, role: "owner" });
    // Admin before plain member.
    expect(body.servers[1]?.role).toBe("admin");
    expect(body.servers[2]?.role).toBe("member");
    expect(body.personalServerId).toBe(myOwn.id);
  });

  it("falls back: defaultServerId follows users.default_server_id when set; otherwise personal", async () => {
    const user = await seedUser();
    const own = await seedServer(user);
    // Unset case → defaultServerId mirrors personalServerId.
    let res = await request(app as never, "https://test.local/api/v1/me", {
      headers: { authorization: await userBearer(user) },
    });
    let body = await res.json() as { defaultServerId: string; personalServerId: string };
    expect(body.defaultServerId).toBe(body.personalServerId);
    expect(body.defaultServerId).toBe(own.id);

    // Set to a different workspace the user is also a member of.
    const otherOwner = await seedUser();
    const otherSrv = await seedServer(otherOwner);
    await joinAsMember(otherSrv.id, user.id);
    await db().update(schema.user).set({ defaultServerId: otherSrv.id }).where(eq(schema.user.id, user.id));

    res = await request(app as never, "https://test.local/api/v1/me", {
      headers: { authorization: await userBearer(user) },
    });
    body = await res.json() as { defaultServerId: string; personalServerId: string };
    expect(body.defaultServerId).toBe(otherSrv.id);
    expect(body.personalServerId).toBe(own.id);  // unchanged
  });

  it("falls back to personal when default_server_id points at a workspace the user is no longer a member of", async () => {
    const user = await seedUser();
    const own = await seedServer(user);
    const ghostOwner = await seedUser();
    const ghost = await seedServer(ghostOwner);
    // User was a member of `ghost`, set as default, then removed.
    await joinAsMember(ghost.id, user.id);
    await db().update(schema.user).set({ defaultServerId: ghost.id }).where(eq(schema.user.id, user.id));
    await db().delete(schema.serverMembers).where(eq(schema.serverMembers.memberId, user.id));
    // Re-add the user as owner of their personal workspace (delete above
    // wiped that too).
    await joinAsMember(own.id, user.id);
    await db().update(schema.serverMembers).set({ role: "owner" })
      .where(eq(schema.serverMembers.memberId, user.id));

    const res = await request(app as never, "https://test.local/api/v1/me", {
      headers: { authorization: await userBearer(user) },
    });
    const body = await res.json() as { defaultServerId: string; personalServerId: string };
    expect(body.defaultServerId).toBe(own.id);
  });
});

describe("PATCH /api/v1/me/default-server", () => {
  it("sets the default workspace and is reflected in subsequent /me calls", async () => {
    const user = await seedUser();
    const own = await seedServer(user);
    const otherOwner = await seedUser();
    const otherSrv = await seedServer(otherOwner);
    await joinAsMember(otherSrv.id, user.id);
    const bearer = await userBearer(user);

    const patch = await request(app as never, "https://test.local/api/v1/me/default-server", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify({ serverId: otherSrv.id }),
    });
    expect(patch.status).toBe(200);

    const me = await request(app as never, "https://test.local/api/v1/me", {
      headers: { authorization: bearer },
    });
    const body = await me.json() as { defaultServerId: string };
    expect(body.defaultServerId).toBe(otherSrv.id);

    // PATCH with null clears, falls back to personal in /me.
    const clear = await request(app as never, "https://test.local/api/v1/me/default-server", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify({ serverId: null }),
    });
    expect(clear.status).toBe(200);
    const me2 = await request(app as never, "https://test.local/api/v1/me", {
      headers: { authorization: bearer },
    });
    const body2 = await me2.json() as { defaultServerId: string; personalServerId: string };
    expect(body2.defaultServerId).toBe(body2.personalServerId);
    expect(body2.defaultServerId).toBe(own.id);
  });

  it("rejects setting a workspace the user is not a member of", async () => {
    const alice = await seedUser();
    await seedServer(alice);
    const bob = await seedUser();
    const bobSrv = await seedServer(bob);
    const res = await request(app as never, "https://test.local/api/v1/me/default-server", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: await userBearer(alice) },
      body: JSON.stringify({ serverId: bobSrv.id }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects machine-key bearers (403)", async () => {
    const user = await seedUser();
    const srv = await seedServer(user);
    const key = await bridgeKey(user, srv);
    const res = await request(app as never, "https://test.local/api/v1/me/default-server", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ serverId: srv.id }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated callers (401)", async () => {
    const user = await seedUser();
    const srv = await seedServer(user);
    const res = await request(app as never, "https://test.local/api/v1/me/default-server", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serverId: srv.id }),
    });
    expect(res.status).toBe(401);
  });
});

describe("runOnboarding side effects", () => {
  it("sets user.default_server_id to the freshly-created personal workspace", async () => {
    // Insert user directly (the same way better-auth would after
    // email-verify), then call runOnboarding ourselves to mimic the
    // user.create.after hook.
    const id = crypto.randomUUID();
    const email = `onb-${id.slice(0, 8)}@test.local`;
    const now = new Date();
    await db().insert(schema.user).values({
      id, email, name: "Onboarding Tester", emailVerified: true, createdAt: now, updatedAt: now,
    });
    await runOnboarding(env, { id, email, name: "Onboarding Tester" } as never);

    const rows = await db().select({ defaultServerId: schema.user.defaultServerId })
      .from(schema.user).where(eq(schema.user.id, id)).limit(1);
    expect(rows[0]?.defaultServerId).toBeTruthy();
    // The personal workspace's ownerId should match this user.
    const srv = await db().select().from(schema.servers)
      .where(eq(schema.servers.id, rows[0]!.defaultServerId!)).limit(1);
    expect(srv[0]?.ownerId).toBe(id);
  });
});

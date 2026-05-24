import { describe, expect, it } from "vitest";
import { newAuthCtx, policy, type Subject } from "../src/policy";

type StubRow = Record<string, unknown>;

/**
 * Same lightweight shape as policy.test.ts: shim the drizzle
 * select().from(table).where(...).limit(...) chain and return canned rows by
 * table identity. This variant supports multiple reads of the same table so
 * channel member checks and agent-in-channel checks can differ in one gate.
 */
function stubDb(rows: { table: string; data: StubRow[] }[]) {
  const queues = new Map<string, StubRow[][]>();
  for (const row of rows) {
    const queue = queues.get(row.table) ?? [];
    queue.push(row.data);
    queues.set(row.table, queue);
  }

  const tableName = (table: { _name?: string; config?: { name?: string } } | any) =>
    table?._name || table?.config?.name || table?.[Symbol.for("drizzle:Name")];

  const takeRows = (table?: string) => {
    if (!table) return [];
    const queue = queues.get(table);
    if (!queue || queue.length === 0) return [];
    return queue.shift() ?? [];
  };

  const make = (table?: string) => {
    let pendingTable = table;
    const chain: any = {
      select: () => chain,
      from: (t: { _name?: string; config?: { name?: string } } | any) => {
        pendingTable = tableName(t) || pendingTable;
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(takeRows(pendingTable)),
      then: (cb: (rows: StubRow[]) => unknown) => cb(takeRows(pendingTable)),
    };
    return chain;
  };

  return make() as any;
}

const userSubject = (userId = "u1"): Subject => ({ kind: "user", userId, via: "cookie" });
const machineSubject = (serverId = "srvA", userId = "u1"): Subject => ({
  kind: "machine",
  userId,
  serverId,
  keyId: "k1",
});

describe("policy.channels.canAddMember", () => {
  it("allows a user who is a channel member", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channel_members", data: [{ id: "ch1" }] },
    ]), userSubject());

    expect(await policy.channels.canAddMember(ctx, "ch1")).toBe(true);
  });

  it("allows a user who has an agent in the channel but is not a human member", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channel_members", data: [] },
      { table: "channel_members", data: [{ id: "agent1" }] },
    ]), userSubject());

    expect(await policy.channels.canAddMember(ctx, "ch1")).toBe(true);
  });

  it("denies a workspace member who is not in the channel", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "server_members", data: [{ id: "srvA" }] },
      { table: "channel_members", data: [] },
      { table: "channel_members", data: [] },
    ]), userSubject());

    expect(await policy.channels.canAddMember(ctx, "ch1")).toBe(false);
  });

  it("denies a machine subject scoped to the wrong server", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channels", data: [] },
    ]), machineSubject("srvB"));

    expect(await policy.channels.canAddMember(ctx, "ch1")).toBe(false);
  });

  it("allows a machine subject scoped to the channel's server when the calling user is a channel member", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channels", data: [{ id: "ch1" }] },
      { table: "channel_members", data: [{ id: "ch1" }] },
    ]), machineSubject("srvA"));

    expect(await policy.channels.canAddMember(ctx, "ch1")).toBe(true);
  });
});

describe("policy.channels.canRemoveMember", () => {
  it("allows the channel creator", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channels", data: [{ createdBy: "u1", serverId: "srvA" }] },
    ]), userSubject());

    expect(await policy.channels.canRemoveMember(ctx, "ch1")).toBe(true);
  });

  it("allows the workspace owner who is not the channel creator", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channels", data: [{ createdBy: "u2", serverId: "srvA" }] },
      { table: "servers", data: [{ id: "srvA" }] },
    ]), userSubject());

    expect(await policy.channels.canRemoveMember(ctx, "ch1")).toBe(true);
  });

  it("denies an ordinary channel member", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channels", data: [{ createdBy: "u2", serverId: "srvA" }] },
      { table: "channel_members", data: [{ id: "ch1" }] },
      { table: "servers", data: [] },
    ]), userSubject());

    expect(await policy.channels.canRemoveMember(ctx, "ch1")).toBe(false);
  });

  it("denies a non-member", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channels", data: [{ createdBy: "u2", serverId: "srvA" }] },
      { table: "servers", data: [] },
    ]), userSubject("u3"));

    expect(await policy.channels.canRemoveMember(ctx, "ch1")).toBe(false);
  });

  it("denies a machine subject scoped to the wrong server", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channels", data: [] },
    ]), machineSubject("srvB"));

    expect(await policy.channels.canRemoveMember(ctx, "ch1")).toBe(false);
  });
});

describe("policy.channels.canLeave", () => {
  it("allows a channel member", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channel_members", data: [{ id: "ch1" }] },
    ]), userSubject());

    expect(await policy.channels.canLeave(ctx, "ch1")).toBe(true);
  });

  it("allows an agent owner whose agent is in the channel", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channel_members", data: [] },
      { table: "channel_members", data: [{ id: "agent1" }] },
    ]), userSubject());

    expect(await policy.channels.canLeave(ctx, "ch1")).toBe(true);
  });

  it("denies a non-participant", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channel_members", data: [] },
      { table: "channel_members", data: [] },
    ]), userSubject());

    expect(await policy.channels.canLeave(ctx, "ch1")).toBe(false);
  });

  it("denies a machine subject scoped to the wrong server", async () => {
    const ctx = newAuthCtx(stubDb([
      { table: "channels", data: [] },
    ]), machineSubject("srvB"));

    expect(await policy.channels.canLeave(ctx, "ch1")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { newAuthCtx, policy, type Subject } from "../src/policy";

/**
 * Lightweight DB stub. We don't run drizzle's query builder against a real
 * sqlite — instead we shim the `select().from(table).where(...)` chain to
 * return canned rows based on table identity. Enough to exercise the
 * machine-vs-user gates that bug-analyzer flagged.
 */
function stubDb(rows: { table: string; data: Record<string, unknown>[] }[]) {
  const fn: any = () => fn;
  const make = (table?: string) => {
    let pendingTable = table;
    const chain: any = {
      select: () => chain,
      from: (t: { _name?: string } | any) => {
        // drizzle wraps tables; we identify by the symbol name we set below.
        pendingTable = (t && (t._name || (t.config?.name) || (t[Symbol.for("drizzle:Name")]))) || pendingTable;
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows.find(r => r.table === pendingTable)?.data ?? []),
      then: (cb: any) => cb(rows.find(r => r.table === pendingTable)?.data ?? []),
    };
    return chain;
  };
  return make() as any;
}

const human: Subject = { kind: "user", userId: "u1" };
const machineSrvA: Subject = { kind: "machine", userId: "u1", serverId: "srvA", keyId: "k1" };

describe("policy.servers.canRead", () => {
  it("allows a user who is a server member", async () => {
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: "srvA" }]) }) }),
      }),
    } as any;
    const ctx = newAuthCtx(db, human);
    expect(await policy.servers.canRead(ctx, "srvA")).toBe(true);
  });

  it("denies machine subject when targetServerId !== subject.serverId (eval Tier S2)", async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: "srvB" }]) }) }) }),
    } as any;
    const ctx = newAuthCtx(db, machineSrvA);
    // Even though membership query would return a hit, machineScoped() returns
    // false because srvB != srvA — that's the whole point of the fix.
    expect(await policy.servers.canRead(ctx, "srvB")).toBe(false);
  });

  it("allows machine subject when targetServerId === subject.serverId", async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: "srvA" }]) }) }) }),
    } as any;
    const ctx = newAuthCtx(db, machineSrvA);
    expect(await policy.servers.canRead(ctx, "srvA")).toBe(true);
  });
});

describe("policy.servers.canCreate", () => {
  it("allows a user", async () => {
    const ctx = newAuthCtx({} as any, human);
    expect(await policy.servers.canCreate(ctx)).toBe(true);
  });
  it("denies a machine (machine keys can't create new servers)", async () => {
    const ctx = newAuthCtx({} as any, machineSrvA);
    expect(await policy.servers.canCreate(ctx)).toBe(false);
  });
});

describe("policy.machineKeys", () => {
  it("only the owner can revoke their own keys", async () => {
    const ctx = newAuthCtx({} as any, human);
    expect(await policy.machineKeys.canRevoke(ctx, "u1")).toBe(true);
    expect(await policy.machineKeys.canRevoke(ctx, "u2")).toBe(false);
  });
  it("machine subjects cannot manage their own keys (only humans)", async () => {
    const ctx = newAuthCtx({} as any, machineSrvA);
    expect(await policy.machineKeys.canRevoke(ctx, "u1")).toBe(false);
    expect(await policy.machineKeys.canRead(ctx, "u1")).toBe(false);
    expect(await policy.machineKeys.canCreate(ctx)).toBe(false);
  });
});

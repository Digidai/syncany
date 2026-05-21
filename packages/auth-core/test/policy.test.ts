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
    // canCreate now requires a serverId; non-membership ⇒ denied.
    const dbNotMember = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    } as any;
    expect(await policy.machineKeys.canCreate(newAuthCtx(dbNotMember, machineSrvA), "srvA")).toBe(false);
  });
  it("user who is a server member CAN mint a key for that server", async () => {
    const dbMember = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: "srvA" }]) }) }) }),
    } as any;
    expect(await policy.machineKeys.canCreate(newAuthCtx(dbMember, human), "srvA")).toBe(true);
  });
  it("user who is NOT a server member cannot mint a key for that server (the round-1 security gap)", async () => {
    const dbNotMember = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    } as any;
    expect(await policy.machineKeys.canCreate(newAuthCtx(dbNotMember, human), "srvA")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// New role-aware policy methods (canEdit / canLeave / userServerRole)
// ---------------------------------------------------------------------------

/** Build a stub db whose serverMembers.role query returns the given row. */
function dbWithRole(role: "owner" | "admin" | "member" | null) {
  const rows = role ? [{ role }] : [];
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }),
  } as any;
}

describe("policy.servers.canEdit (owner+admin)", () => {
  it("allows owner", async () => {
    expect(await policy.servers.canEdit(newAuthCtx(dbWithRole("owner"), human), "srvA")).toBe(true);
  });
  it("allows admin", async () => {
    expect(await policy.servers.canEdit(newAuthCtx(dbWithRole("admin"), human), "srvA")).toBe(true);
  });
  it("denies regular member", async () => {
    expect(await policy.servers.canEdit(newAuthCtx(dbWithRole("member"), human), "srvA")).toBe(false);
  });
  it("denies non-member (no row)", async () => {
    expect(await policy.servers.canEdit(newAuthCtx(dbWithRole(null), human), "srvA")).toBe(false);
  });
  it("denies machine subjects entirely (workspace admin is human-only)", async () => {
    expect(await policy.servers.canEdit(newAuthCtx(dbWithRole("owner"), machineSrvA), "srvA")).toBe(false);
  });
});

describe("policy.servers.canLeave (non-owner member)", () => {
  /** canLeave checks: machineScoped(ok for user) AND userIsServerMember AND
   *  NOT userIsServerOwner. Each gate hits a different table; the stub
   *  needs to answer all three. We make the membership query and the
   *  owner-check query distinguishable by row count. */
  function dbForLeave({ isMember, isOwner }: { isMember: boolean; isOwner: boolean }) {
    // Both userIsServerMember and userIsServerOwner do `.select(...).from(...).where(...).limit(1)`.
    // Differentiate by mutating which call returns which response — the
    // simplest mock: alternate by call sequence. canLeave first awaits
    // userIsServerMember (memo'd), THEN awaits userIsServerOwner (memo'd).
    let call = 0;
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              const which = call++;
              const ans = which === 0 ? isMember : isOwner;
              return Promise.resolve(ans ? [{ id: "srvA" }] : []);
            },
          }),
        }),
      }),
    } as any;
  }
  it("allows admin or regular member who is not the owner", async () => {
    expect(await policy.servers.canLeave(newAuthCtx(dbForLeave({ isMember: true, isOwner: false }), human), "srvA")).toBe(true);
  });
  it("DENIES the owner — they must transfer or delete instead", async () => {
    expect(await policy.servers.canLeave(newAuthCtx(dbForLeave({ isMember: true, isOwner: true }), human), "srvA")).toBe(false);
  });
  it("denies a non-member (can't leave what you didn't join)", async () => {
    expect(await policy.servers.canLeave(newAuthCtx(dbForLeave({ isMember: false, isOwner: false }), human), "srvA")).toBe(false);
  });
  it("denies machine subjects (human-only action)", async () => {
    expect(await policy.servers.canLeave(newAuthCtx(dbForLeave({ isMember: true, isOwner: false }), machineSrvA), "srvA")).toBe(false);
  });
});

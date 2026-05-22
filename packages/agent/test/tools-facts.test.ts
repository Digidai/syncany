/**
 * Unit tests for fact tools — predicate whitelist, ACL on supersede,
 * input validation. We mock the D1 layer because facts are I/O-bound;
 * the integration tests under apps/api/test cover the end-to-end DB path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { factsTools, PREDICATE_WHITELIST, SUBJECT_KINDS } from "../src/tools/facts.js";
import type { ToolDispatchCtx } from "../src/tools/registry.js";

// Minimal in-memory rows store + drizzle-shaped surface. We don't need
// SQL semantics — just round-trip values + the .where() filter chain.
function makeMockDb() {
  const rows: Record<string, unknown>[] = [];
  const insertedValues: Record<string, unknown>[] = [];
  const updates: Array<{ where: unknown; set: Record<string, unknown> }> = [];
  const deletes: unknown[] = [];
  // After the new update().where() races: simulate the "old row got
  // superseded" by stamping the in-memory row's supersededBy with the
  // newId from the set payload (so the follow-up SELECT sees it).
  return {
    rows,
    insertedValues,
    updates,
    deletes,
    insert: () => ({
      values: async (v: Record<string, unknown>) => { rows.push(v); insertedValues.push(v); },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: async (w: unknown) => {
          updates.push({ where: w, set: s });
          // Apply set fields onto the first matching row (we don't
          // implement WHERE parsing — just take the first un-set
          // supersededBy row).
          for (const r of rows) {
            if (r.supersededBy == null && s.supersededBy != null) {
              r.supersededBy = s.supersededBy;
              break;
            }
          }
        },
      }),
    }),
    delete: () => ({
      where: async (w: unknown) => { deletes.push(w); },
    }),
    select: (_cols?: unknown) => ({
      from: () => ({
        where: () => ({
          limit: (_n: number) => Promise.resolve(rows.slice()),
        }),
      }),
    }),
  };
}

function makeCtx(mockDb: ReturnType<typeof makeMockDb>): ToolDispatchCtx {
  return {
    state: {
      agentId: "agent-1",
      workspaceId: "w",
      ownerId: "o",
      runtime: "raltic",
      history: [],
      todoList: [],
      workspaceContainerId: null,
      workspaceContainerBearer: null,
      totalTokensThisPeriod: 0,
      taskStartedAt: null,
      lastActiveAt: 0,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env: { DB: mockDb as any } as any,
    sandbox: null,
    ensureSandbox: async () => { throw new Error("nope"); },
    updateTodo: async () => {},
    updateSchedules: async () => [],
    appendTerminal: async () => {},
  };
}

// drizzle's drizzle(env.DB) is called inside each tool. Stub it to
// return our mock directly so we don't touch the real driver.
vi.mock("drizzle-orm/d1", () => ({
  drizzle: (db: unknown) => db,
}));

describe("predicate whitelist", () => {
  it("contains the documented core set", () => {
    for (const p of ["works_on", "prefers", "timezone", "email", "note"]) {
      expect(PREDICATE_WHITELIST.has(p)).toBe(true);
    }
  });
  it("does NOT contain free-form predicates", () => {
    expect(PREDICATE_WHITELIST.has("loves")).toBe(false);
    expect(PREDICATE_WHITELIST.has("WORKS_ON")).toBe(false);   // case-sensitive
  });
});

describe("subject kinds", () => {
  it("are exactly the 5 expected values", () => {
    expect([...SUBJECT_KINDS].sort()).toEqual(
      ["agent", "channel", "concept", "project", "user"],
    );
  });
});

describe("fact_record", () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  beforeEach(() => { mockDb = makeMockDb(); });

  it("inserts a row for a valid whitelisted predicate", async () => {
    const tools = factsTools(makeCtx(mockDb));
    const res = await tools.fact_record!.execute!(
      {
        subjectKind: "user",
        subjectId: "user-gene",
        predicate: "timezone",
        object: "Asia/Taipei",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).ok).toBe(true);
    expect(mockDb.insertedValues).toHaveLength(1);
    const row = mockDb.insertedValues[0]!;
    expect(row.agentId).toBe("agent-1");
    expect(row.subjectId).toBe("user-gene");
    expect(row.predicate).toBe("timezone");
    expect(row.object).toBe("Asia/Taipei");
    expect(row.confidence).toBe(0.8);                // default
    expect(row.supersededBy).toBeNull();
  });

  it("rejects non-whitelisted predicates", async () => {
    const tools = factsTools(makeCtx(mockDb));
    await expect(tools.fact_record!.execute!(
      {
        subjectKind: "user",
        subjectId: "u",
        predicate: "loves",              // not in whitelist
        object: "ts",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    )).rejects.toThrow(/not in whitelist/);
    expect(mockDb.insertedValues).toHaveLength(0);
  });

  it("zod rejects empty object", () => {
    const tools = factsTools(makeCtx(mockDb));
    const schema = (tools.fact_record!).inputSchema!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = (schema as any).safeParse({
      subjectKind: "user", subjectId: "u", predicate: "note", object: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("zod rejects confidence outside [0,1]", () => {
    const tools = factsTools(makeCtx(mockDb));
    const schema = (tools.fact_record!).inputSchema!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = (schema as any).safeParse({
      subjectKind: "user", subjectId: "u", predicate: "note", object: "x", confidence: 1.5,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("fact_query", () => {
  it("calls select chain and returns rows + count", async () => {
    const mockDb = makeMockDb();
    mockDb.rows.push(
      { id: "f1", subjectKind: "user", subjectId: "u", predicate: "note", object: "x", confidence: 0.9, createdAt: new Date() },
    );
    const tools = factsTools(makeCtx(mockDb));
    const res = await tools.fact_query!.execute!(
      { subjectId: "u" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).count).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).facts[0].id).toBe("f1");
  });

  it("zod respects max limit", () => {
    const tools = factsTools(makeCtx(makeMockDb()));
    const schema = (tools.fact_query!).inputSchema!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = (schema as any).safeParse({ limit: 9999 });
    expect(parsed.success).toBe(false);
  });
});

describe("fact_supersede", () => {
  it("refuses to supersede a fact owned by another agent (ACL)", async () => {
    const mockDb = makeMockDb();
    // The "existing" row belongs to a different agent.
    mockDb.rows.push({
      id: "f1",
      agentId: "OTHER-AGENT",
      subjectKind: "user",
      subjectId: "u",
      predicate: "note",
      supersededBy: null,
    });
    const tools = factsTools(makeCtx(mockDb));
    await expect(tools.fact_supersede!.execute!(
      { oldId: "f1", newObject: "x" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    )).rejects.toThrow(/not authorized/);
  });

  it("refuses to supersede an already-superseded fact", async () => {
    const mockDb = makeMockDb();
    mockDb.rows.push({
      id: "f1",
      agentId: "agent-1",
      subjectKind: "user",
      subjectId: "u",
      predicate: "note",
      supersededBy: "f2",
    });
    const tools = factsTools(makeCtx(mockDb));
    await expect(tools.fact_supersede!.execute!(
      { oldId: "f1", newObject: "x" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    )).rejects.toThrow(/already superseded/);
  });

  it("happy path: inserts new + updates old", async () => {
    const mockDb = makeMockDb();
    mockDb.rows.push({
      id: "f1",
      agentId: "agent-1",
      subjectKind: "user",
      subjectId: "u",
      predicate: "timezone",
      supersededBy: null,
    });
    const tools = factsTools(makeCtx(mockDb));
    const res = await tools.fact_supersede!.execute!(
      { oldId: "f1", newObject: "America/Los_Angeles" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).ok).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).oldId).toBe("f1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).newId).toBeTruthy();
    // 1 insert (new fact row) + 1 update (old row marked superseded)
    expect(mockDb.insertedValues).toHaveLength(1);
    expect(mockDb.updates).toHaveLength(1);
  });

  it("non-existent oldId throws", async () => {
    const mockDb = makeMockDb();
    const tools = factsTools(makeCtx(mockDb));
    await expect(tools.fact_supersede!.execute!(
      { oldId: "nope", newObject: "x" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    )).rejects.toThrow(/no fact with id/);
  });
});

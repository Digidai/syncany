/**
 * Unit tests for memory tools.
 *
 * We mock the SandboxClient — the goal is to verify path computation,
 * tombstone behavior, recall flow, and category routing. The actual
 * file I/O is tested via the sandbox-daemon integration tests.
 */
import { describe, it, expect, vi } from "vitest";
import {
  memoryTools,
  MEMORY_ROOT,
  computeMemoryPath,
  slugify,
  assertWithinMemoryRoot,
  formatMemoryEntry,
} from "../src/tools/memory.js";
import type { ToolDispatchCtx } from "../src/tools/registry.js";

interface MockSandbox {
  fileWrite: ReturnType<typeof vi.fn>;
  fileRead: ReturnType<typeof vi.fn>;
  fileList: ReturnType<typeof vi.fn>;
  grep: ReturnType<typeof vi.fn>;
}

function makeCtx(sandbox: MockSandbox): ToolDispatchCtx {
  return {
    state: {
      agentId: "a",
      workspaceId: "w",
      ownerId: "o",
      runtime: "raltic",
      history: [],
      todoList: [],
      workspaceContainerId: "sbx-test",
      workspaceContainerBearer: "bearer-test",
      totalTokensThisPeriod: 0,
      taskStartedAt: null,
      lastActiveAt: 0,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sandbox: sandbox as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ensureSandbox: async () => sandbox as any,
    updateTodo: async () => {},
    updateSchedules: async () => [],
    appendTerminal: async () => {},
  };
}

describe("slugify", () => {
  it("kebab-cases ascii", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
  it("preserves CJK", () => {
    expect(slugify("用户笔记")).toBe("用户笔记");
  });
  it("strips traversal-y chars", () => {
    expect(slugify("../etc/passwd")).toBe("etc-passwd");
  });
  it("falls back to 'untitled' for empty", () => {
    expect(slugify("---")).toBe("untitled");
  });
  it("caps length", () => {
    const s = "a".repeat(200);
    expect(slugify(s).length).toBeLessThanOrEqual(80);
  });
});

describe("computeMemoryPath", () => {
  it("uses subjectId when provided for person", () => {
    const p = computeMemoryPath({ category: "person", title: "Some Title", subjectId: "user-123" });
    expect(p).toBe(`${MEMORY_ROOT}/people/user-123.md`);
  });
  it("date+time-buckets scratch so same-day same-title doesn't collide", () => {
    const p = computeMemoryPath({ category: "scratch", title: "Quick note" });
    expect(p).toMatch(new RegExp(`^${MEMORY_ROOT}/scratch/\\d{4}-\\d{2}-\\d{2}-\\d{6}-quick-note\\.md$`));
  });
  it("two scratches close together get distinct paths", () => {
    // Mock the system clock so the test is deterministic — without it,
    // two calls in the same millisecond would still produce identical
    // paths. vi.useFakeTimers + setSystemTime advances new Date() too.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-22T13:45:09.000Z"));
      const a = computeMemoryPath({ category: "scratch", title: "same" });
      vi.setSystemTime(new Date("2026-05-22T13:45:11.000Z"));   // +2s
      const b = computeMemoryPath({ category: "scratch", title: "same" });
      expect(a).not.toBe(b);
    } finally {
      vi.useRealTimers();
    }
  });
  it("decision is intentionally same-day-same-title overwrite", () => {
    const a = computeMemoryPath({ category: "decision", title: "Switch DB" });
    const b = computeMemoryPath({ category: "decision", title: "Switch DB" });
    expect(a).toBe(b);
  });
  it("date-buckets decision", () => {
    const p = computeMemoryPath({ category: "decision", title: "Switch to Postgres" });
    expect(p).toMatch(new RegExp(`^${MEMORY_ROOT}/decisions/\\d{4}-\\d{2}-\\d{2}-switch-to-postgres\\.md$`));
  });
  it("project uses slugified title", () => {
    const p = computeMemoryPath({ category: "project", title: "Raltic Migration" });
    expect(p).toBe(`${MEMORY_ROOT}/projects/raltic-migration.md`);
  });
});

describe("assertWithinMemoryRoot", () => {
  it("accepts valid memory paths", () => {
    expect(() => assertWithinMemoryRoot(`${MEMORY_ROOT}/people/x.md`)).not.toThrow();
  });
  it("rejects paths outside root", () => {
    expect(() => assertWithinMemoryRoot("/workspace/etc/passwd")).toThrow();
  });
  it("rejects .. traversal", () => {
    expect(() => assertWithinMemoryRoot(`${MEMORY_ROOT}/../etc`)).toThrow();
  });
});

describe("formatMemoryEntry", () => {
  it("emits front-matter + body", () => {
    const s = formatMemoryEntry({ title: "Gene", body: "loves typescript", subjectId: "u1" });
    expect(s).toContain("title: Gene");
    expect(s).toContain("subject_id: u1");
    expect(s).toContain("updated_at:");
    expect(s).toContain("loves typescript");
  });
  it("strips newlines from title in fm", () => {
    const s = formatMemoryEntry({ title: "Line1\nLine2", body: "x" });
    expect(s).toContain("title: Line1 Line2");
  });
});

describe("memory_remember", () => {
  it("writes via sandbox with computed path", async () => {
    const sandbox: MockSandbox = {
      fileWrite: vi.fn(async () => ({ ok: true, path: "x", bytes: 42 })),
      fileRead: vi.fn(),
      fileList: vi.fn(),
      grep: vi.fn(),
    };
    const tools = memoryTools(makeCtx(sandbox));
    const res = await tools.memory_remember!.execute!(
      { category: "person", title: "About Gene", subjectId: "u-gene", body: "Backend engineer." },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    expect(sandbox.fileWrite).toHaveBeenCalledTimes(1);
    const [path, content] = sandbox.fileWrite.mock.calls[0]!;
    expect(path).toBe(`${MEMORY_ROOT}/people/u-gene.md`);
    expect(content).toContain("Backend engineer.");
    expect(content).toContain("subject_id: u-gene");
    expect(res).toMatchObject({ ok: true, path: `${MEMORY_ROOT}/people/u-gene.md` });
  });

  it("rejects body over cap via zod", () => {
    const sandbox = {
      fileWrite: vi.fn(),
      fileRead: vi.fn(),
      fileList: vi.fn(),
      grep: vi.fn(),
    };
    const tools = memoryTools(makeCtx(sandbox));
    const schema = (tools.memory_remember!).inputSchema!;
    // schema is z.object — call safeParse manually to verify validation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = (schema as any).safeParse({
      category: "person",
      title: "ok",
      body: "x".repeat(25_000),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown category via zod", () => {
    const sandbox = {
      fileWrite: vi.fn(),
      fileRead: vi.fn(),
      fileList: vi.fn(),
      grep: vi.fn(),
    };
    const tools = memoryTools(makeCtx(sandbox));
    const schema = (tools.memory_remember!).inputSchema!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = (schema as any).safeParse({ category: "evil", title: "x", body: "x" });
    expect(parsed.success).toBe(false);
  });
});

describe("memory_recall", () => {
  it("greps under memory root and reads matches", async () => {
    const sandbox: MockSandbox = {
      fileWrite: vi.fn(),
      fileRead: vi.fn(async (p: string) => ({ content: `body for ${p}`, truncated: false })),
      fileList: vi.fn(),
      grep: vi.fn(async () => ({ matches: [
        { path: `${MEMORY_ROOT}/people/u-1.md`, line: 1, text: "match" },
        { path: `${MEMORY_ROOT}/people/u-1.md`, line: 5, text: "match again" },
        { path: `${MEMORY_ROOT}/projects/raltic.md`, line: 2, text: "raltic match" },
      ] })),
    };
    const tools = memoryTools(makeCtx(sandbox));
    const res = await tools.memory_recall!.execute!(
      { query: "match", limit: 5 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    expect(sandbox.grep).toHaveBeenCalledTimes(1);
    const [pattern, opts] = sandbox.grep.mock.calls[0]!;
    expect(pattern).toBe("match");
    expect(opts.path).toBe(MEMORY_ROOT);
    expect(opts.ignoreCase).toBe(true);
    // Deduplicated — same path twice = one entry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).matched).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).entries.map((e: any) => e.path)).toEqual([
      `${MEMORY_ROOT}/people/u-1.md`,
      `${MEMORY_ROOT}/projects/raltic.md`,
    ]);
  });

  it("handles grep failure gracefully (no matches, no throw)", async () => {
    const sandbox: MockSandbox = {
      fileWrite: vi.fn(),
      fileRead: vi.fn(),
      fileList: vi.fn(),
      grep: vi.fn(async () => { throw new Error("grep down"); }),
    };
    const tools = memoryTools(makeCtx(sandbox));
    const res = await tools.memory_recall!.execute!(
      { query: "x" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).matched).toBe(0);
  });
});

describe("memory_list", () => {
  it("walks all four category dirs by default", async () => {
    const sandbox: MockSandbox = {
      fileWrite: vi.fn(),
      fileRead: vi.fn(),
      fileList: vi.fn(async (p: string) => ({
        path: p,
        entries: [{ name: "a.md", kind: "file" }, { name: "subdir", kind: "dir" }],
      })),
      grep: vi.fn(),
    };
    const tools = memoryTools(makeCtx(sandbox));
    const res = await tools.memory_list!.execute!(
      {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    // Four categories × 1 file each (subdir filtered) = 4 entries
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).count).toBe(4);
    expect(sandbox.fileList).toHaveBeenCalledTimes(4);
  });

  it("skips missing dirs silently", async () => {
    let calls = 0;
    const sandbox: MockSandbox = {
      fileWrite: vi.fn(),
      fileRead: vi.fn(),
      fileList: vi.fn(async () => {
        calls++;
        if (calls % 2 === 0) throw new Error("ENOENT");
        return { path: "x", entries: [{ name: "f.md", kind: "file" }] };
      }),
      grep: vi.fn(),
    };
    const tools = memoryTools(makeCtx(sandbox));
    const res = await tools.memory_list!.execute!(
      {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    // Half the dirs error, the other half return 1 entry each = 2 results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).count).toBe(2);
  });
});

describe("memory_forget", () => {
  it("writes a tombstone (no destructive delete yet)", async () => {
    const sandbox: MockSandbox = {
      fileWrite: vi.fn(async () => ({ ok: true, path: "x", bytes: 70 })),
      fileRead: vi.fn(),
      fileList: vi.fn(),
      grep: vi.fn(),
    };
    const tools = memoryTools(makeCtx(sandbox));
    await tools.memory_forget!.execute!(
      { path: `${MEMORY_ROOT}/scratch/some.md` },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    const [, content] = sandbox.fileWrite.mock.calls[0]!;
    expect(content).toContain("status: forgotten");
    expect(content).toContain("forgotten_at:");
  });

  it("rejects paths outside memory root", async () => {
    const sandbox: MockSandbox = {
      fileWrite: vi.fn(),
      fileRead: vi.fn(),
      fileList: vi.fn(),
      grep: vi.fn(),
    };
    const tools = memoryTools(makeCtx(sandbox));
    await expect(tools.memory_forget!.execute!(
      { path: "/workspace/etc/passwd" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    )).rejects.toThrow(/under /);
  });
});

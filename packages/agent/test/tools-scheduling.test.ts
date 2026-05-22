/**
 * Unit tests for the scheduling tool.
 */
import { describe, it, expect, vi } from "vitest";
import { schedulingTools } from "../src/tools/scheduling.js";
import type { ToolDispatchCtx } from "../src/tools/registry.js";
import type { ScheduledJob } from "../src/types.js";

function makeCtx(initial: ScheduledJob[] = []): { ctx: ToolDispatchCtx; getSchedules: () => ScheduledJob[] } {
  let schedules = [...initial];
  const ctx = {
    state: {
      agentId: "a",
      workspaceId: "w",
      ownerId: "o",
      runtime: "raltic" as const,
      history: [],
      todoList: [],
      workspaceContainerId: null,
      workspaceContainerBearer: null,
      totalTokensThisPeriod: 0,
      taskStartedAt: null,
      lastActiveAt: 0,
      schedules,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env: {} as any,
    sandbox: null,
    ensureSandbox: async () => { throw new Error("nope"); },
    updateTodo: async () => {},
    // Updater contract — receives latest state, returns next. Matches
    // production wiring so concurrent appends compose correctly.
    updateSchedules: async (updater: (current: ScheduledJob[]) => ScheduledJob[]) => {
      const next = updater(schedules);
      schedules = next;
      ctx.state.schedules = next;
      return next;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { ctx, getSchedules: () => schedules };
}

describe("schedule_self", () => {
  it("accepts a valid future schedule", async () => {
    const { ctx, getSchedules } = makeCtx();
    const tools = schedulingTools(ctx);
    const res = await tools.schedule_self!.execute!(
      { delaySeconds: 600, prompt: "remind me", channelId: "c1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: boolean; jobId: string };
    expect(res.ok).toBe(true);
    expect(getSchedules().length).toBe(1);
    expect(getSchedules()[0]!.prompt).toBe("remind me");
  });

  it("schema rejects too-soon schedules (< 60s)", () => {
    const { ctx } = makeCtx();
    const tools = schedulingTools(ctx);
    const schema = (tools.schedule_self as { inputSchema: { safeParse: (x: unknown) => { success: boolean } } }).inputSchema;
    expect(schema.safeParse({ delaySeconds: 30, prompt: "x", channelId: "c1" }).success).toBe(false);
    expect(schema.safeParse({ delaySeconds: 60, prompt: "x", channelId: "c1" }).success).toBe(true);
  });

  it("schema rejects too-far schedules (> 30 days)", () => {
    const { ctx } = makeCtx();
    const tools = schedulingTools(ctx);
    const schema = (tools.schedule_self as { inputSchema: { safeParse: (x: unknown) => { success: boolean } } }).inputSchema;
    expect(schema.safeParse({ delaySeconds: 31 * 24 * 60 * 60, prompt: "x", channelId: "c1" }).success).toBe(false);
    expect(schema.safeParse({ delaySeconds: 30 * 24 * 60 * 60, prompt: "x", channelId: "c1" }).success).toBe(true);
  });

  it("enforces max 20 pending schedules", async () => {
    const initial: ScheduledJob[] = Array.from({ length: 20 }, (_, i) => ({
      id: `j${i}`, fireAt: Date.now() + 1_000_000, prompt: "p", channelId: "c", label: "l",
    }));
    const { ctx } = makeCtx(initial);
    const tools = schedulingTools(ctx);
    await expect(async () => {
      await tools.schedule_self!.execute!(
        { delaySeconds: 600, prompt: "x", channelId: "c1" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { toolCallId: "t1" } as any,
      );
    }).rejects.toThrow(/max 20/);
  });

  it("schema rejects empty prompt", () => {
    const { ctx } = makeCtx();
    const tools = schedulingTools(ctx);
    const schema = (tools.schedule_self as { inputSchema: { safeParse: (x: unknown) => { success: boolean } } }).inputSchema;
    expect(schema.safeParse({ delaySeconds: 600, prompt: "", channelId: "c1" }).success).toBe(false);
  });

  it("schema rejects prompt longer than 2000 chars", () => {
    const { ctx } = makeCtx();
    const tools = schedulingTools(ctx);
    const schema = (tools.schedule_self as { inputSchema: { safeParse: (x: unknown) => { success: boolean } } }).inputSchema;
    expect(schema.safeParse({ delaySeconds: 600, prompt: "a".repeat(2001), channelId: "c1" }).success).toBe(false);
    expect(schema.safeParse({ delaySeconds: 600, prompt: "a".repeat(2000), channelId: "c1" }).success).toBe(true);
  });

  it("schema rejects label longer than 120 chars", () => {
    const { ctx } = makeCtx();
    const tools = schedulingTools(ctx);
    const schema = (tools.schedule_self as { inputSchema: { safeParse: (x: unknown) => { success: boolean } } }).inputSchema;
    expect(schema.safeParse({ delaySeconds: 600, prompt: "x", channelId: "c1", label: "a".repeat(121) }).success).toBe(false);
    expect(schema.safeParse({ delaySeconds: 600, prompt: "x", channelId: "c1", label: "a".repeat(120) }).success).toBe(true);
  });

  it("happy path: schedule appended AND fireAt is correct epoch ms", async () => {
    const { ctx, getSchedules } = makeCtx();
    const tools = schedulingTools(ctx);
    const before = Date.now();
    const res = await tools.schedule_self!.execute!(
      { delaySeconds: 600, prompt: "remind", channelId: "c1", label: "remind-me" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: true; jobId: string; scheduledFor: string };
    expect(res.ok).toBe(true);
    expect(typeof res.jobId).toBe("string");
    const scheduled = getSchedules();
    expect(scheduled.length).toBe(1);
    expect(scheduled[0]!.id).toBe(res.jobId);
    expect(scheduled[0]!.label).toBe("remind-me");
    // Fire time is within ~1s of (before + 600s).
    expect(scheduled[0]!.fireAt).toBeGreaterThanOrEqual(before + 600_000);
    expect(scheduled[0]!.fireAt).toBeLessThanOrEqual(before + 600_000 + 1000);
  });

  it("concurrent schedule_self calls all append (no lost writes)", async () => {
    // The updater pattern means even if both calls observe the same
    // starting state, each one computes from latest at write time.
    // Production wires this through scheduleLock; here we simulate.
    const { ctx, getSchedules } = makeCtx();
    const tools = schedulingTools(ctx);
    await Promise.all([
      tools.schedule_self!.execute!(
        { delaySeconds: 100, prompt: "a", channelId: "c1" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { toolCallId: "t1" } as any,
      ),
      tools.schedule_self!.execute!(
        { delaySeconds: 200, prompt: "b", channelId: "c1" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { toolCallId: "t2" } as any,
      ),
    ]);
    const prompts = getSchedules().map(s => s.prompt).sort();
    expect(prompts).toEqual(["a", "b"]);
  });
});

describe("cancel_schedule", () => {
  it("removes by id", async () => {
    const initial: ScheduledJob[] = [
      { id: "j1", fireAt: Date.now() + 100_000, prompt: "p", channelId: "c", label: "l" },
      { id: "j2", fireAt: Date.now() + 200_000, prompt: "q", channelId: "c", label: "m" },
    ];
    const { ctx, getSchedules } = makeCtx(initial);
    const tools = schedulingTools(ctx);
    const res = await tools.cancel_schedule!.execute!(
      { jobId: "j1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: boolean; remaining: number };
    expect(res.ok).toBe(true);
    expect(res.remaining).toBe(1);
    expect(getSchedules().length).toBe(1);
    expect(getSchedules()[0]!.id).toBe("j2");
  });

  it("returns ok:false for unknown id", async () => {
    const { ctx } = makeCtx();
    const tools = schedulingTools(ctx);
    const res = await tools.cancel_schedule!.execute!(
      { jobId: "missing" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: boolean };
    expect(res.ok).toBe(false);
  });
});

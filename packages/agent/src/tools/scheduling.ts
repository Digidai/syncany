/**
 * Self-scheduling tool — agent sets its own DO alarm to wake up later
 * and perform a follow-up task.
 *
 * Use cases:
 *   - "Remind me in 15 minutes if no one responds"
 *   - "Check this URL hourly and notify me when it changes"
 *   - "Summarize yesterday's #ops channel every weekday at 9am"
 *
 * Implementation:
 *   The Agent base class (CF Agents SDK) wraps DO storage's alarm API.
 *   We append a job entry to state.schedules and set/refresh the
 *   DO alarm to the EARLIEST due time. The Agent's `alarm()` handler
 *   pops due jobs and runs them as fresh invocations.
 *
 * Constraints:
 *   - Free tier capped at 5 schedules per agent (P4 quota will enforce).
 *   - Soonest fire = now + 60s (prevents busy-loop scheduling).
 *   - Latest fire = now + 30 days (prevents indefinite squat on DO state).
 */
import { tool } from "ai";
import { z } from "zod";
import type { ToolDispatchCtx, ToolRegistry } from "./registry.js";

const MIN_DELAY_SECONDS = 60;
const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60;   // 30 days
const MAX_SCHEDULES_PER_AGENT = 20;

export function schedulingTools(ctx: ToolDispatchCtx): ToolRegistry {
  return {
    schedule_self: tool({
      description:
        "Schedule a future invocation of this agent. The agent wakes up at the specified time and processes the provided prompt as if a human sent it. Use for reminders, periodic summaries, or follow-up checks. Minimum 60s in the future, maximum 30 days.",
      inputSchema: z.object({
        delaySeconds: z.number().int()
          .min(MIN_DELAY_SECONDS, `must be at least ${MIN_DELAY_SECONDS}s in the future`)
          .max(MAX_DELAY_SECONDS, `must be within ${MAX_DELAY_SECONDS / (24 * 60 * 60)} days`),
        prompt: z.string().min(1).max(2000)
          .describe("What the agent should do when it wakes up. Treated as a user message."),
        channelId: z.string().min(1)
          .describe("Channel where the resulting message will be posted."),
        label: z.string().max(120).optional()
          .describe("Short human-readable label, shown in 'agent has scheduled' UI."),
      }),
      execute: async ({ delaySeconds, prompt, channelId, label }) => {
        const fireAt = Date.now() + delaySeconds * 1000;
        const job = {
          id: crypto.randomUUID(),
          fireAt,
          prompt,
          channelId,
          label: label ?? prompt.slice(0, 60),
        };
        // Updater pattern: cap-check runs against the LATEST schedules
        // at write time (not a captured snapshot from when the tool was
        // dispatched). Codex caught the race: two concurrent execute()
        // calls would both pass the cap check and append, exceeding it.
        let exceededCap = false;
        await ctx.updateSchedules((current) => {
          if (current.length >= MAX_SCHEDULES_PER_AGENT) {
            exceededCap = true;
            return current;
          }
          return [...current, job];
        });
        if (exceededCap) {
          throw new Error(`max ${MAX_SCHEDULES_PER_AGENT} pending schedules per agent`);
        }
        return { ok: true, scheduledFor: new Date(fireAt).toISOString(), jobId: job.id };
      },
    }),

    cancel_schedule: tool({
      description: "Cancel a previously scheduled job by id.",
      inputSchema: z.object({
        jobId: z.string().min(1),
      }),
      execute: async ({ jobId }) => {
        let removed = false;
        const after = await ctx.updateSchedules((current) => {
          const next = current.filter(j => j.id !== jobId);
          removed = next.length !== current.length;
          return next;
        });
        if (!removed) return { ok: false, error: "no schedule with that id" };
        return { ok: true, remaining: after.length };
      },
    }),
  };
}

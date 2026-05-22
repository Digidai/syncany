import { tool } from "ai";
import type { Tool } from "ai";
import type { SandboxClient } from "../sandbox-client.js";
import type { AgentEnv, AgentState, ScheduledJob } from "../types.js";
import { ralticTools } from "./raltic.js";
import { sandboxTools } from "./sandbox.js";
import { webTools } from "./web.js";
import { channelFilesTools } from "./channel-files.js";
import { schedulingTools } from "./scheduling.js";

export interface ToolDispatchCtx {
  state: AgentState;
  env: AgentEnv;
  /** Lazy — only present when the agent has been allocated a container.
   *  Sandbox tools should NOT use this directly; call ensureSandbox()
   *  which lazy-allocates on first use and returns a fresh client. */
  sandbox: SandboxClient | null;
  /** Lazy-allocate (and return) the sandbox client. Persists container
   *  id + bearer into DO state on first call. Used by every sandbox tool. */
  ensureSandbox: () => Promise<SandboxClient>;
  /** Persist a new todo list through Agent.setState (so the DO storage
   *  layer sees it). Tools that mutate state MUST go through this — a
   *  direct `ctx.state.todoList = ...` is a no-op across hibernation. */
  updateTodo: (next: AgentState["todoList"]) => Promise<void>;
  /** Persist a new schedule list via Agent.setState AND refresh the DO
   *  alarm to the earliest due time. Takes an updater fn that receives
   *  the CURRENT schedules (not a captured snapshot) so concurrent
   *  schedule_self / cancel_schedule calls can't lose each other's
   *  appends. Same persistence reasoning as updateTodo; scheduling
   *  additionally drives DO storage.setAlarm(). */
  updateSchedules: (
    updater: (current: ScheduledJob[]) => ScheduledJob[],
  ) => Promise<ScheduledJob[]>;
  /** Append text to the agent's terminal ring buffer (~4 KiB cap).
   *  bash_exec wraps its result through this so the Workspace pane's
   *  "Recent terminal output" pane actually has something to render.
   *  Best-effort: failures don't break the tool's primary result. */
  appendTerminal: (chunk: string) => Promise<void>;
}

export type ToolRegistry = Record<string, Tool>;

/**
 * Build the per-invocation tool set. Returned shape feeds straight into
 * `streamText({ tools })`. Tools whose dependencies aren't met (e.g.
 * sandbox tools when container isn't allocated yet) are still present —
 * their `execute` handler is responsible for lazy-allocating.
 *
 * Future P2 will inject connector tools here based on agent's
 * connected_tokens; for now we only return raltic+sandbox.
 */
export function buildToolRegistry(ctx: ToolDispatchCtx): ToolRegistry {
  return {
    ...ralticTools(ctx),
    ...sandboxTools(ctx),
    ...webTools(ctx),
    ...channelFilesTools(ctx),
    ...schedulingTools(ctx),
  };
}

// Re-export `tool` for in-house tool authors (so they don't have to
// pull `ai` directly and we can later swap if needed).
export { tool };

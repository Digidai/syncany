import { tool } from "ai";
import type { Tool } from "ai";
import type { SandboxClient } from "../sandbox-client.js";
import type { AgentEnv, AgentState } from "../types.js";
import { ralticTools } from "./raltic.js";
import { sandboxTools } from "./sandbox.js";

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
  };
}

// Re-export `tool` for in-house tool authors (so they don't have to
// pull `ai` directly and we can later swap if needed).
export { tool };

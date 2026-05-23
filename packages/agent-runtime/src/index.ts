export type {
  ActivityEvent,
  ActivityListener,
  AgentRuntime,
  AuthMethod,
  DetectResult,
  DetectedRuntimeSnapshot,
  ExitListener,
  PermissionMode,
  RuntimeCapabilities,
  RuntimeId,
  RuntimeSession,
  SpawnOpts,
} from "./types.js";

export { ClaudeRuntime, ensureAgentWorkdir, readMemory } from "./claude.js";
export { CodexRuntime, writeAgentsRootSentinel } from "./codex.js";
export { OpenClawRuntime } from "./openclaw.js";
export { HermesRuntime } from "./hermes.js";

import type { AgentRuntime, RuntimeId } from "./types.js";
import { ClaudeRuntime } from "./claude.js";
import { CodexRuntime } from "./codex.js";
import { OpenClawRuntime } from "./openclaw.js";
import { HermesRuntime } from "./hermes.js";

/**
 * Singleton runtime registry consumed by AgentManager.
 *
 * Adding a runtime here makes it pickable from the UI; nothing else
 * in the bridge needs to know the runtime name.
 *
 * Lifecycle:
 *   - claude / codex: per_turn_spawn — bridge owns the process
 *   - openclaw / hermes: external_daemon — user installs + runs the
 *     daemon themselves; bridge shells out to the CLI per turn.
 *
 * Removed in the OpenClaw+Hermes integration: gemini + copilot
 * scaffolds (detect() worked but spawn() always threw — UI dead-end
 * when a user picked them). If/when those CLIs warrant integration,
 * follow the openclaw.ts / hermes.ts pattern.
 */
export function buildRuntimeRegistry(): Record<RuntimeId, AgentRuntime> {
  return {
    claude:   new ClaudeRuntime(),
    codex:    new CodexRuntime(),
    openclaw: new OpenClawRuntime(),
    hermes:   new HermesRuntime(),
  };
}

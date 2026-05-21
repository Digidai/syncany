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
export { GeminiRuntime } from "./gemini.js";
export { CopilotRuntime } from "./copilot.js";

import type { AgentRuntime, RuntimeId } from "./types.js";
import { ClaudeRuntime } from "./claude.js";
import { CodexRuntime } from "./codex.js";
import { GeminiRuntime } from "./gemini.js";
import { CopilotRuntime } from "./copilot.js";

/**
 * Singleton runtime registry consumed by AgentManager.
 *
 * Adding a runtime here makes it pickable from the UI; nothing else
 * in the bridge needs to know the runtime name.
 *
 * gemini + copilot are SCAFFOLDS — detect() reports availability so
 * the Runtimes panel can show "ready" / "not installed", but spawn()
 * throws. Don't expose them in the agent-create UI until the spawn
 * paths land. See their files for what's pending.
 */
export function buildRuntimeRegistry(): Record<RuntimeId, AgentRuntime> {
  return {
    claude:  new ClaudeRuntime(),
    codex:   new CodexRuntime(),
    gemini:  new GeminiRuntime(),
    copilot: new CopilotRuntime(),
  };
}

/**
 * Gemini CLI runtime — SCAFFOLD ONLY (pending full implementation).
 *
 * Why this file exists in the tree:
 *   The product wants 4 runtimes (claude / codex / gemini / copilot)
 *   instead of just 2, because users have different paid CLI accounts.
 *   Without scaffolding here, every runtime extension PR touches the
 *   same 6 files in parallel (types enum, registry, db schema, web
 *   picker, wizard step 1, RuntimeDot). Stubbing first lets a single
 *   integration PR per runtime focus on the spawn/parse logic.
 *
 * What's NOT done yet:
 *   - The `detect()` + `spawn()` paths below are minimal — they probe
 *     `gemini --version` but the streaming output parser, session-id
 *     persistence, and JSON event protocol need real integration work.
 *   - The `agents.runtime` DB enum still only allows claude|codex. A
 *     follow-up migration must extend it AND backfill the agent-create
 *     UI runtime picker.
 *   - Bridge-core's broadcastLifecycle runtime-availability check
 *     reads from this `detect()` output already (per A2 work) — once
 *     this stub returns honest authed=false values, the UI will say
 *     "gemini CLI not authed" correctly.
 *
 * To enable in production:
 *   1. Implement spawn() + streaming output parsing for Gemini's CLI.
 *   2. Run migration adding "gemini" to agents.runtime enum.
 *   3. Add to web wizard step 1's RuntimePick options.
 */
import { spawnSync } from "child_process";
import type { AgentRuntime, DetectResult, RuntimeCapabilities, RuntimeSession, SpawnOpts } from "./types.js";

export class GeminiRuntime implements AgentRuntime {
  readonly id = "gemini" as const;
  readonly displayName = "Gemini";
  // Scaffold capabilities — refine with the actual SDK options when
  // spawn() lands. Conservative defaults so the agent-create UI shows
  // something sensible if a user ever picks this runtime.
  readonly capabilities: RuntimeCapabilities = {
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    defaultModel: "gemini-2.5-pro",
    permissionModes: ["default"],
    conversational: true,
    resumable: false,  // scaffold — Gemini CLI session resume not wired
    supportsShellTools: false,
  };

  async detect(): Promise<DetectResult> {
    // Probe `gemini --version`. CLI may or may not be installed on the
    // user's PATH — we report not-detected gracefully, never throw.
    try {
      const res = spawnSync("gemini", ["--version"], { encoding: "utf-8", timeout: 3000 });
      if (res.status !== 0) {
        return { error: "gemini CLI not installed (or --version failed)" };
      }
      const version = (res.stdout || res.stderr).trim().split("\n")[0] ?? null;
      // Real auth probe requires `gemini login --status` or similar.
      // For now report unknown so the UI shows the install-runtime path.
      return { version, authed: null, authMethod: "none" };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Spawn a Gemini session. STUB — throws so the bridge surfaces a
   * loud error rather than silently swallowing dispatch when an agent
   * with runtime=gemini gets a message before this is implemented.
   * The A2 mismatch check (bridge-core/bridge.ts:broadcastLifecycle)
   * should already prevent this codepath in practice by reporting the
   * agent as error before the first dispatch, but defense in depth.
   */
  spawn(_opts: SpawnOpts): RuntimeSession {
    throw new Error(
      "[gemini] runtime spawn not implemented yet — agents with runtime=gemini cannot be dispatched. " +
      "Track: packages/agent-runtime/src/gemini.ts",
    );
  }
}

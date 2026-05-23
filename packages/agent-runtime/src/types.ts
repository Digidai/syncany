/**
 * Agent runtime abstraction.
 *
 * One implementation per AI agent CLI we support (currently: Claude Code,
 * Codex). The bridge consumes runtimes via a registry; nothing else in
 * the codebase should reach for CLI specifics.
 *
 * Design history: see docs/MULTI_RUNTIME_CLAUDE_CODEX.md.
 */

// Adding a new runtime: extend this union AND
//   - add an implementation file in this package (claude.ts pattern)
//   - register it in buildRuntimeRegistry() in index.ts
//   - extend `agents.runtime` enum in packages/db/src/schema.ts + migration
//   - extend RUNTIME_MODELS in packages/protocol/src/rest.ts
//   - extend RUNTIME_LABEL + the wizard RuntimePick options in web
//
// Lifecycle:
//   claude / codex     — per_turn_spawn, bridge owns the process
//   openclaw / hermes  — external_daemon, user installs+runs the
//                         daemon themselves; bridge shells out per turn
//                         (see docs/DESIGN_openclaw_hermes_runtimes.md).
//                         Raltic never holds their provider API keys.
//
// Removed: gemini + copilot. They were scaffolds (detect worked,
// spawn threw) that caused a UI dead-end if a user picked them. If
// either warrants integration later, follow the openclaw.ts pattern.
export type RuntimeId = "claude" | "codex" | "openclaw" | "hermes";

export type PermissionMode = "readOnly" | "default" | "acceptEdits" | "bypassPermissions";

export type AuthMethod = "oauth" | "env" | "none";

export interface RuntimeCapabilities {
  /** Model identifiers the runtime accepts. */
  models: readonly string[];
  /** Friendly default — usually `models[0]`. */
  defaultModel: string;
  /** Permission modes this runtime understands. */
  permissionModes: readonly PermissionMode[];
  /** Multi-turn conversation supported (always true for both today). */
  conversational: boolean;
  /** Session resumable after process exit (always true for both today). */
  resumable: boolean;
  /** Has a shell-equivalent tool the agent can invoke. */
  supportsShellTools: boolean;
  /**
   * Process lifecycle of the underlying tool — drives UX hints and
   * detection logic. OPTIONAL; defaults to "per_turn_spawn" so the
   * pre-existing claude/codex/gemini/copilot capability literals don't
   * need touching.
   *
   *   per_turn_spawn:    bridge spawns a CLI per turn (claude, codex)
   *                      — Raltic owns the process lifecycle.
   *   external_daemon:   a long-lived daemon the USER installed +
   *                      manages (openclaw, hermes); bridge probes
   *                      its liveness via detect() but doesn't
   *                      start/stop it. The CLI is a per-turn client.
   *
   * Bridge UX surfaces the difference: external_daemon runtimes show
   * "daemon offline — start it yourself" rather than the generic
   * "agent crashed" copy.
   */
  lifecycle?: "per_turn_spawn" | "external_daemon";
}

export interface DetectResult {
  /** Path/name of the binary we found. */
  binary?: string;
  /** Version string from `<cli> --version`. */
  version?: string | null;
  /** Whether the CLI is currently authenticated. */
  authed?: boolean | null;
  /** How it's authenticated (OAuth login vs env var) — for UI display. */
  authMethod?: AuthMethod | null;
  /** Human-readable error if detection failed. */
  error?: string | null;
}

export interface SpawnOpts {
  /** Per-agent working directory (already exists). */
  workDir: string;
  /** Rendered system prompt. Runtime decides whether to pass via flag
   *  (Claude `--append-system-prompt`) or write to AGENTS.md (Codex). */
  systemPrompt: string;
  /** Model id — must be one of `capabilities.models`. */
  model: string;
  /** Permission level the user picked. */
  permissionMode: PermissionMode;
  /** Optional allowlist (Claude honors this; Codex ignores — sandbox is the gate). */
  allowedTools?: readonly string[];
  /** Session id from a prior turn (`getResumeKey()` of a previous session). */
  resumeKey?: string | null;
  /** Environment variables for the child process. Bridge owns the build
   *  (PATH-prepended ralticDir + RALTIC_AGENT_* + FORCE_COLOR=0). */
  env: Record<string, string>;
}

/** Normalised activity event surface — same shape regardless of runtime.
 *  AgentManager subscribes to these and forwards to the API. */
export type ActivityEvent =
  | { kind: "thinking" }
  | { kind: "working"; tool: string; label: string; detail: string }
  | {
      kind: "text";
      text: string;
      /** True if this text frame REPLACES the previous one (both Claude
       *  and Codex emit full-text-per-frame, not deltas; document
       *  consumer must treat as replacement). */
      replaces: boolean;
    }
  | { kind: "turn_complete"; sessionId: string }
  | {
      kind: "needs_restart";
      reason: "compacting" | "prompt_changed" | "error";
    }
  | {
      kind: "error";
      message: string;
      // not_installed / permission_denied / spawn_failed are SPAWN-time
      // diagnostics: the runtime binary couldn't be started. Surfaced
      // separately so the UI can render install or chmod guidance
      // instead of the generic "agent crashed" toast.
      reason?:
        | "auth"
        | "rate_limit"
        | "network"
        | "budget"
        | "not_installed"
        | "permission_denied"
        | "spawn_failed"
        | "other";
    };

export type ActivityListener = (event: ActivityEvent) => void;
export type ExitListener = (code: number | null) => void;

export interface RuntimeSession {
  /** Child process pid if applicable (Claude has one; Codex SDK doesn't
   *  expose a stable pid because it spawns per turn). */
  readonly pid: number | null;
  /** Send a user message into the running session. Caller MUST NOT call
   *  this concurrently — AgentManager enforces serialisation. */
  send(text: string): Promise<void>;
  /** Subscribe to events. Multiple listeners allowed; remove with the
   *  function returned. */
  on(event: "activity", cb: ActivityListener): () => void;
  on(event: "exit", cb: ExitListener): () => void;
  /** Stable resume key (Claude session_id / Codex threadId) captured
   *  during the most recent turn. Null if not yet captured. */
  getResumeKey(): string | null;
  /** Cleanup. Idempotent. */
  shutdown(): Promise<void>;
}

export interface AgentRuntime {
  readonly id: RuntimeId;
  readonly displayName: string;
  readonly capabilities: RuntimeCapabilities;
  /** Verify the CLI is installed + (best-effort) authenticated. Bridge
   *  calls this at boot, with a timeout caller. */
  detect(): Promise<DetectResult>;
  /** Spawn a fresh session. Caller is responsible for shutting it down. */
  spawn(opts: SpawnOpts): RuntimeSession;
}

/** Snapshot serialised to the wire when bridge POSTs /connect.
 *  Mirrors the protocol package's `detectedRuntimeSnapshot` zod shape. */
export interface DetectedRuntimeSnapshot {
  id: RuntimeId;
  detected: boolean;
  version: string | null;
  authed: boolean | null;
  authMethod: AuthMethod | null;
  error: string | null;
}

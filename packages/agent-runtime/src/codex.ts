/**
 * CodexRuntime — wraps the `@openai/codex-sdk` Thread API.
 *
 * SDK behavior (verified against openai/codex sdk/typescript/src/* per
 * the Review 1 findings in docs/MULTI_RUNTIME_CLAUDE_CODEX.md):
 *
 *  - `new Codex(options)` — options: codexPathOverride|baseUrl|apiKey|config|env.
 *  - `codex.startThread(threadOptions)` returns a `Thread`.
 *  - `codex.resumeThread(id, threadOptions?)` returns a `Thread`.
 *  - `await thread.runStreamed(prompt)` returns `Promise<{ events: AsyncGenerator<ThreadEvent> }>`.
 *  - threadId arrives via the `thread.started` event mid-stream (NOT
 *    `thread.id` after the loop).
 *  - No `Thread.end()` / `close()` — SDK spawns `codex exec` per turn,
 *    nothing to clean up between turns.
 *  - Per-event item types: `reasoning`, `agent_message`, `command_execution`,
 *    `file_change` (with `changes: FileUpdateChange[]`), `mcp_tool_call`
 *    (NOT `mcp_call`), `web_search`. `turn.completed` finalises with usage.
 *
 * Permission mapping: ALL daemon modes set `approvalPolicy: "never"` —
 * the bridge has no human to answer approval prompts; any other value
 * makes Codex hang waiting. Sandbox is the actual gate.
 *
 * System prompt: written to `<workDir>/AGENTS.md` on every spawn (not
 * a CLI flag). A sentinel `~/.raltic/agents/AGENTS.md` should be set
 * by AgentManager at init to terminate Codex's upward walk so stray
 * `~/AGENTS.md` files don't leak in.
 */

import { execFile } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import type {
  ActivityEvent,
  ActivityListener,
  AgentRuntime,
  AuthMethod,
  DetectResult,
  ExitListener,
  PermissionMode,
  RuntimeCapabilities,
  RuntimeSession,
  SpawnOpts,
} from "./types.js";

const execFileP = promisify(execFile);

const CAPABILITIES: RuntimeCapabilities = {
  models: ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex-spark"] as const,
  defaultModel: "gpt-5.4",
  permissionModes: ["readOnly", "default", "acceptEdits", "bypassPermissions"] as const,
  conversational: true,
  resumable: true,
  supportsShellTools: true,
};

// SDK type stubs — we treat @openai/codex-sdk as `unknown` at the
// import boundary and narrow inside the adapter. This avoids hard-
// coupling against a specific SDK version's exported types (the SDK
// is still evolving; pinning the type signature would block upgrades).
// Real types live in `@openai/codex-sdk`.
type CodexConstructor = new (opts: {
  env?: Record<string, string>;
  config?: Record<string, unknown>;
  apiKey?: string;
  baseUrl?: string;
}) => CodexClient;
interface CodexClient {
  startThread(opts: ThreadOptions): Thread;
  resumeThread(id: string, opts?: ThreadOptions): Thread;
}
interface ThreadOptions {
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  model?: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "untrusted" | "on-request" | "on-failure" | "never";
}
interface Thread {
  runStreamed(prompt: string): Promise<{ events: AsyncIterable<ThreadEvent> }>;
}
interface ThreadEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export class CodexRuntime implements AgentRuntime {
  readonly id = "codex" as const;
  readonly displayName = "OpenAI Codex";
  readonly capabilities = CAPABILITIES;

  // Lazy-loaded SDK constructor — we don't want to require @openai/codex-sdk
  // at module-load time so the bridge boots even when only Claude is
  // installed. The dynamic import happens on first spawn().
  private _Codex: CodexConstructor | null = null;

  async detect(): Promise<DetectResult> {
    try {
      const { stdout } = await execFileP("codex", ["--version"], { timeout: 3000 });
      const version = stdout.trim();
      const oauthAuthed = await this._oauthAuthed();
      const envAuthed = !!(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY);
      const authMethod: AuthMethod =
        oauthAuthed ? "oauth" : envAuthed ? "env" : "none";
      return {
        binary: "codex",
        version,
        authed: oauthAuthed || envAuthed,
        authMethod,
      };
    } catch (e) {
      return { error: `codex not installed or detect timed out: ${(e as Error).message}` };
    }
  }

  private async _oauthAuthed(): Promise<boolean> {
    try {
      await execFileP("codex", ["login", "status"], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  spawn(opts: SpawnOpts): RuntimeSession {
    // Synchronously construct the session; the actual `Codex` instantiation
    // happens lazily inside CodexSession.send() so we can dynamic-import
    // the SDK on first use.
    return new CodexSession(opts, () => this._loadSdk());
  }

  private async _loadSdk(): Promise<CodexConstructor> {
    if (this._Codex) return this._Codex;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("@openai/codex-sdk").catch((e) => {
      throw new Error(
        `@openai/codex-sdk not available. Codex agents require this package: ${(e as Error).message}`,
      );
    });
    this._Codex = mod.Codex as CodexConstructor;
    return this._Codex;
  }
}

class CodexSession implements RuntimeSession {
  readonly pid = null; // SDK spawns codex exec per turn — no stable pid
  private threadId: string | null;
  private thread: Thread | null = null;
  private listeners: { activity: ActivityListener[]; exit: ExitListener[] } = {
    activity: [],
    exit: [],
  };
  // Write AGENTS.md before any spawn so Codex reads the fresh prompt.
  // Sentinel at the agents dir level is the bridge's job (it knows the
  // root). Here we just write the per-agent file.
  constructor(
    private opts: SpawnOpts,
    private loadCodex: () => Promise<CodexConstructor>,
  ) {
    this.threadId = opts.resumeKey ?? null;
    this._writeAgentsMd();
  }

  async send(text: string): Promise<void> {
    if (!this.thread) {
      const Codex = await this.loadCodex();
      const codex = new Codex({ env: this.opts.env });
      const threadOptions: ThreadOptions = {
        workingDirectory: this.opts.workDir,
        skipGitRepoCheck: true,
        model: this.opts.model,
        sandboxMode: this._sandboxFor(this.opts.permissionMode),
        approvalPolicy: "never", // see class docstring — always never for daemon
      };
      this.thread = this.threadId
        ? codex.resumeThread(this.threadId, threadOptions)
        : codex.startThread(threadOptions);
      // AGENTS.md may have been touched between turns; rewrite to be safe.
      this._writeAgentsMd();
    }

    try {
      const { events } = await this.thread.runStreamed(text);
      for await (const ev of events) {
        this._mapEvent(ev);
      }
    } catch (e) {
      this._classifyError(e);
    }
  }

  on(event: "activity", cb: ActivityListener): () => void;
  on(event: "exit", cb: ExitListener): () => void;
  on(event: "activity" | "exit", cb: ActivityListener | ExitListener): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.listeners[event] as any[]).push(cb as any);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr = this.listeners[event] as any[];
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  getResumeKey(): string | null {
    return this.threadId;
  }

  async shutdown(): Promise<void> {
    // No SDK method to close a Thread. Dropping the reference is enough;
    // GC handles it. Emit exit so AgentManager can clean its sessions map.
    for (const cb of this.listeners.exit) {
      try { cb(0); } catch { /* swallow */ }
    }
  }

  // ── Event mapping ──

  private _mapEvent(ev: ThreadEvent) {
    if (ev.type === "thread.started") {
      // Capture threadId IN-STREAM. Available on this event, not on
      // thread.id after the loop completes.
      const id = ev.threadId ?? ev.thread_id ?? ev.id;
      if (typeof id === "string" && id) this.threadId = id;
      return;
    }
    if (ev.type === "item.completed") {
      const it = ev.item ?? {};
      switch (it.type) {
        case "reasoning":
          return this._emit({ kind: "thinking" });
        case "agent_message":
          return this._emit({ kind: "text", text: String(it.text ?? ""), replaces: true });
        case "command_execution":
          return this._emit({
            kind: "working",
            tool: "Shell",
            label: "Running command",
            detail: String(it.command ?? "").slice(0, 80),
          });
        case "file_change": {
          // Codex SDK shape: changes: Array<{ path; kind }>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const paths = ((it.changes ?? []) as Array<{ path?: string }>).map((c) => c.path ?? "").filter(Boolean);
          return this._emit({
            kind: "working",
            tool: "Edit",
            label: paths.length > 1 ? `Editing ${paths.length} files` : "Editing file",
            detail: paths.join(", ").slice(0, 80),
          });
        }
        case "mcp_tool_call":
          return this._emit({
            kind: "working",
            tool: String(it.server ?? "MCP"),
            label: String(it.tool ?? ""),
            detail: "",
          });
        case "web_search":
          return this._emit({
            kind: "working",
            tool: "WebSearch",
            label: String(it.query ?? ""),
            detail: "",
          });
        case "todo_list":
          // Surface as a working event so the UI shows planning progress
          // instead of dropping it silently.
          return this._emit({
            kind: "working",
            tool: "Plan",
            label: "Updating plan",
            detail: "",
          });
        case "error": {
          // Per-item error (distinct from top-level turn.failed). Surface
          // but don't synthesize turn_complete — turn.completed/failed
          // arrive separately.
          const msg = String(it.message ?? it.error ?? "item error").slice(0, 200);
          return this._emit({ kind: "error", message: msg, reason: this._classifyReason(msg) });
        }
        default:
          // Unknown item subtype — keep parser forward-compatible.
          if (process.env.RALTIC_BRIDGE_VERBOSE) {
            console.warn(`[codex-runtime] unknown item.type: ${it.type}`, it);
          }
          return;
      }
    }
    if (ev.type === "turn.completed") {
      return this._emit({ kind: "turn_complete", sessionId: this.threadId ?? "" });
    }
    if (ev.type === "turn.failed") {
      // CRITICAL — without this, AgentManager never sees turn_complete
      // and the agent stays `busy: true` forever, blocking all future
      // user messages. Map to error + synthetic turn_complete so the
      // queue drains and the user sees the failure.
      const err = ev.error as { message?: string } | undefined;
      const msg = err?.message ?? String(ev.message ?? "turn failed");
      this._emit({ kind: "error", message: msg, reason: this._classifyReason(msg) });
      return this._emit({ kind: "turn_complete", sessionId: this.threadId ?? "" });
    }
    if (ev.type === "error" || ev.type === "stream.error") {
      return this._emit({
        kind: "error",
        message: String(ev.message ?? "codex error"),
        reason: "other",
      });
    }
    // Other events (thread.completed, turn.started, item.started, etc.)
    // intentionally not surfaced — they're transitions we don't need
    // to render in the activity stream.
  }

  private _classifyError(e: unknown) {
    const msg = String((e as Error)?.message ?? e);
    this._emit({ kind: "error", message: msg, reason: this._classifyReason(msg) });
    // After an error mid-turn, also emit turn_complete so AgentManager's
    // queue drains and the agent isn't stuck "busy" forever.
    this._emit({ kind: "turn_complete", sessionId: this.threadId ?? "" });
  }

  private _classifyReason(msg: string): "auth" | "rate_limit" | "network" | "budget" | "other" {
    return /auth|token|login|unauthor/i.test(msg) ? "auth"
      : /rate.?limit|429/i.test(msg) ? "rate_limit"
      : /network|ECONN|ETIMED|fetch failed/i.test(msg) ? "network"
      : /budget|quota|context.?window/i.test(msg) ? "budget"
      : "other";
  }

  private _emit(ev: ActivityEvent) {
    for (const cb of this.listeners.activity) {
      try { cb(ev); } catch { /* never propagate */ }
    }
  }

  private _sandboxFor(mode: PermissionMode): "read-only" | "workspace-write" | "danger-full-access" {
    switch (mode) {
      case "readOnly":          return "read-only";
      case "default":           return "read-only";
      case "acceptEdits":       return "workspace-write";
      case "bypassPermissions": return "danger-full-access";
      default:                  return "workspace-write";
    }
  }

  private _writeAgentsMd() {
    const path = join(this.opts.workDir, "AGENTS.md");
    const body = `<!-- AUTOGENERATED by raltic bridge — edits will be overwritten on next spawn -->\n\n${this.opts.systemPrompt}\n`;
    try {
      writeFileSync(path, body, "utf8");
    } catch (e) {
      console.warn(`[codex-runtime] failed to write AGENTS.md at ${path}:`, (e as Error).message);
    }
  }
}

/**
 * Sentinel file written ONCE at bridge init to terminate Codex's upward
 * AGENTS.md walk at the agents root. Without this, a stray ~/AGENTS.md
 * or ~/.raltic/AGENTS.md would be merged into every agent's prompt.
 */
export function writeAgentsRootSentinel(agentsRootDir: string): void {
  const path = join(agentsRootDir, "AGENTS.md");
  if (existsSync(path)) return;
  try {
    writeFileSync(
      path,
      "<!-- raltic bridge sentinel — terminates Codex AGENTS.md walk; do not edit -->\n",
      "utf8",
    );
  } catch {
    /* best-effort — bridge can still run without the sentinel */
  }
}

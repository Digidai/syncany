/**
 * ClaudeRuntime — wraps `claude` CLI (Claude Code).
 *
 * Extracted from the prior monolithic `apps/bridge/src/agent-manager.ts`.
 * Behavior here is intentionally identical to what shipped before the
 * multi-runtime refactor; the only change is that activity events are
 * EMITTED (for AgentManager to forward) instead of POSTed inline.
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type {
  ActivityEvent,
  ActivityListener,
  AgentRuntime,
  DetectResult,
  ExitListener,
  RuntimeCapabilities,
  RuntimeSession,
  SpawnOpts,
} from "./types.js";

const execFileP = promisify(execFile);

const CAPABILITIES: RuntimeCapabilities = {
  models: ["sonnet", "opus", "haiku"] as const,
  defaultModel: "sonnet",
  permissionModes: ["readOnly", "default", "acceptEdits", "bypassPermissions"] as const,
  conversational: true,
  resumable: true,
  supportsShellTools: true,
};

export class ClaudeRuntime implements AgentRuntime {
  readonly id = "claude" as const;
  readonly displayName = "Anthropic Claude Code";
  readonly capabilities = CAPABILITIES;

  async detect(): Promise<DetectResult> {
    try {
      const { stdout } = await execFileP("claude", ["--version"]);
      const version = stdout.trim();
      // Claude Code stores auth in ~/.claude/. We don't shell out to
      // check (no public subcommand); presence of a session is good
      // enough as a heuristic. UI shows "version detected" and trusts
      // the user has run `claude` once locally.
      return { binary: "claude", version, authed: true, authMethod: "oauth" };
    } catch (e) {
      return { error: `claude not installed: ${(e as Error).message}` };
    }
  }

  spawn(opts: SpawnOpts): RuntimeSession {
    return new ClaudeSession(opts);
  }
}

// ── Stream parser: NDJSON event → ActivityEvent ──

function describeToolUse(block: { name?: string; input?: Record<string, unknown> }): {
  label: string;
  detail: string;
} {
  const name = block?.name || "tool";
  const input = (block?.input || {}) as Record<string, unknown>;
  switch (name) {
    case "Bash":     return { label: "Running command", detail: String(input.command || "").slice(0, 80) };
    case "Read":     return { label: "Reading file",    detail: String(input.file_path || "").slice(0, 80) };
    case "Write":    return { label: "Writing file",    detail: String(input.file_path || "").slice(0, 80) };
    case "Edit":     return { label: "Editing file",    detail: String(input.file_path || "").slice(0, 80) };
    case "WebFetch": return { label: "Fetching URL",    detail: String(input.url || "").slice(0, 80) };
    case "WebSearch":return { label: "Searching web",   detail: String(input.query || "").slice(0, 80) };
    case "Grep":     return { label: "Searching code",  detail: String(input.pattern || "").slice(0, 80) };
    case "Glob":     return { label: "Finding files",   detail: String(input.pattern || "").slice(0, 80) };
    default:         return { label: `Running ${name}`, detail: "" };
  }
}

class ClaudeSession implements RuntimeSession {
  private proc: ChildProcess;
  private sessionId: string | null = null;
  private stdoutBuffer = "";
  private listeners: { activity: ActivityListener[]; exit: ExitListener[] } = {
    activity: [],
    exit: [],
  };

  constructor(private opts: SpawnOpts) {
    const args = [
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--append-system-prompt", opts.systemPrompt,
      "--allowedTools", (opts.allowedTools ?? []).join(",") || "Read,Glob,Grep",
      "--permission-mode", mapPermissionMode(opts.permissionMode),
      "--model", opts.model,
    ];
    if (opts.resumeKey) {
      args.push("--resume", opts.resumeKey);
      this.sessionId = opts.resumeKey;
    }

    this.proc = spawn("claude", args, {
      cwd: opts.workDir,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString();
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) this._onLine(line.trim());
      }
    });

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      if (/Reconnecting\.\.\.|Falling back from WebSockets/i.test(text)) return;
      console.error(`[claude-runtime] stderr: ${text.substring(0, 200)}`);
    });

    // Spawn-time errors (ENOENT — claude not on PATH; EACCES — not
    // executable) arrive asynchronously on this `error` event. Before
    // we classified them, the AgentManager treated spawn as successful,
    // any pending dispatch silently sat in the queue, and the only
    // signal was a generic "error" activity. Reviewers caught this:
    // the inbound message never reaches the agent, the user sees no
    // hint, and the bridge keeps trying to restart into the same broken
    // executable. Map error.code → ActivityEvent.reason, emit an exit
    // event so the queue drains, so the higher layer can broadcast a
    // diagnostic.
    this.proc.on("error", (err: NodeJS.ErrnoException) => {
      // ENOENT: claude not found on PATH (most common — user hasn't
      // installed claude-code, or PATH inside the bridge env is stripped).
      // EACCES: file exists but not executable (chmod issue).
      // EPERM: kernel refused (rare — sandbox, seatbelt, etc.).
      const reason =
        err.code === "ENOENT" ? "not_installed" as const :
        err.code === "EACCES" || err.code === "EPERM" ? "permission_denied" as const :
        "spawn_failed" as const;
      const message =
        err.code === "ENOENT"
          ? "claude-code CLI not found on PATH. Install with `npm i -g @anthropic-ai/claude-code` or set CLAUDE_PATH."
          : err.code === "EACCES" || err.code === "EPERM"
          ? `claude binary not executable (${err.code}): ${err.message}`
          : `claude spawn failed: ${err.message}`;
      this._emit({ kind: "error", message, reason });
      // Synthesize an exit so AgentManager's queue can drain instead of
      // dispatch waiting forever for a process that never started.
      for (const cb of this.listeners.exit) {
        try { cb(null); } catch { /* listener exceptions don't propagate */ }
      }
    });

    this.proc.on("close", (code: number | null) => {
      for (const cb of this.listeners.exit) {
        try { cb(code); } catch { /* listener exceptions don't propagate */ }
      }
    });
  }

  get pid(): number | null {
    return this.proc.pid ?? null;
  }

  async send(text: string): Promise<void> {
    const payload = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      ...(this.sessionId ? { session_id: this.sessionId } : {}),
    });
    this.proc.stdin?.write(payload + "\n");
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
    return this.sessionId;
  }

  async shutdown(): Promise<void> {
    if (this.proc.killed || this.proc.exitCode !== null) return;
    // Graceful first: SIGTERM lets claude flush in-flight stdout (the
    // assistant frame the user JUST saw streaming) before exiting. Wait
    // up to 2s; if claude ignores SIGTERM — known to happen when it's
    // mid-tool-call holding a child of its own — escalate to SIGKILL.
    // Without the SIGKILL fallback the bridge process.exit (apps/bridge
    // /src/index.ts SIGINT handler) returns while a zombie claude
    // child keeps the parent process group alive; on shells that wait
    // for the process group, Ctrl-C hangs forever.
    try { this.proc.kill("SIGTERM"); } catch { /* already dead */ }
    await new Promise<void>((resolve) => {
      const onClose = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        this.proc.off("close", onClose);
        try { this.proc.kill("SIGKILL"); } catch { /* already dead */ }
        // SIGKILL is uncatchable so the next close fires synchronously
        // from the kernel; still resolve immediately so callers don't
        // wait indefinitely if the child is in uninterruptible IO.
        resolve();
      }, 2000);
      this.proc.once("close", onClose);
    });
  }

  // ── Event mapper — single source of truth for Claude NDJSON → ActivityEvent ──

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _onLine(line: string) {
    let event: any;
    try { event = JSON.parse(line); } catch { return; }

    switch (event.type) {
      case "system":
        if (event.subtype === "init" && event.session_id) {
          // CRITICAL: capture sessionId SYNCHRONOUSLY before any emit
          // so getResumeKey() reflects the latest value when listeners run.
          this.sessionId = event.session_id;
        } else if (event.subtype === "compacting") {
          this._emit({ kind: "needs_restart", reason: "compacting" });
        }
        break;

      case "assistant": {
        const block = event.message?.content?.[0];
        if (!block) break;
        if (block.type === "thinking") {
          this._emit({ kind: "thinking" });
        } else if (block.type === "text") {
          // Claude emits FULL text per frame (overwrite semantics, not delta).
          this._emit({ kind: "text", text: block.text || "", replaces: true });
        } else if (block.type === "tool_use") {
          const { label, detail } = describeToolUse(block);
          this._emit({ kind: "working", tool: block.name || "tool", label, detail });
        }
        break;
      }

      case "result": {
        if (event.session_id) this.sessionId = event.session_id;
        this._emit({ kind: "turn_complete", sessionId: this.sessionId ?? "" });
        break;
      }
    }
  }

  private _emit(ev: ActivityEvent): void {
    for (const cb of this.listeners.activity) {
      try { cb(ev); } catch { /* never propagate listener errors */ }
    }
  }
}

/** Map our 4 user-facing modes to Claude's three CLI modes. */
function mapPermissionMode(mode: SpawnOpts["permissionMode"]): string {
  switch (mode) {
    case "readOnly":          return "default";          // Claude has no read-only; default prompts on everything
    case "default":           return "default";
    case "acceptEdits":       return "acceptEdits";
    case "bypassPermissions": return "bypassPermissions";
    default:                  return "acceptEdits";
  }
}

// ── Side-effect helpers — kept here for now, may move into bridge ──

export function ensureAgentWorkdir(rootDir: string, agentId: string, displayName: string): string {
  const workDir = join(rootDir, agentId);
  if (!existsSync(workDir)) {
    mkdirSync(workDir, { recursive: true });
    mkdirSync(join(workDir, "notes"), { recursive: true });
    const memoryContent = `# ${displayName}\n\n## Role\n${displayName}\n\n## Key Knowledge\n- No notes saved yet.\n\n## Active Context\n- Workspace initialized at ${new Date().toISOString().split("T")[0]}.\n`;
    writeFileSync(join(workDir, "MEMORY.md"), memoryContent);
  }
  return workDir;
}

export function readMemory(workDir: string): string {
  const memoryPath = join(workDir, "MEMORY.md");
  return existsSync(memoryPath) ? readFileSync(memoryPath, "utf-8") : "";
}

/**
 * OpenClawRuntime — wraps the user's installed `openclaw` CLI (Peter
 * Steinberger's local-first AI assistant + multi-channel gateway).
 *
 * Trust model — identical to ClaudeRuntime / CodexRuntime:
 *   - Raltic does NOT bundle openclaw. User installs it themselves:
 *       npm i -g openclaw && openclaw onboard --install-daemon
 *   - The daemon owns the provider API key (OpenAI/Anthropic). Raltic
 *     never sees it.
 *   - Bridge shells out to `openclaw agent --message <text> --json`
 *     per turn (the daemon does the LLM work; the CLI is a thin
 *     client). Per-turn shell-out matches Claude/Codex.
 *
 * Lifecycle: external_daemon. detect() probes both the binary AND the
 * daemon's `gateway status` so we can distinguish "not installed"
 * from "installed but daemon down" in the UI.
 *
 * ⚠️ SMOKE TEST REQUIRED before shipping any real user traffic to
 * this runtime — see docs/DESIGN_openclaw_hermes_runtimes.md §4.8 +
 * docs/SAMPLES_openclaw.jsonl scaffold. The event-parser shapes below
 * are derived from OpenClaw's README + `--help` output but the live
 * `--json` event grammar is unverified. Replace `parseOpenClawEvent`
 * once real samples land.
 */
import { spawn, spawnSync, type ChildProcess } from "child_process";
import type {
  ActivityEvent,
  ActivityListener,
  AgentRuntime,
  DetectResult,
  ExitListener,
  PermissionMode,
  RuntimeCapabilities,
  RuntimeSession,
  SpawnOpts,
} from "./types.js";

const CAPABILITIES: RuntimeCapabilities = {
  // The "auto" sentinel lets the daemon's router pick a model based
  // on whatever providers the user has keys for. Explicit names are
  // surfaced for users who want to pin.
  models: ["auto", "claude-sonnet-4-6", "gpt-5.4", "gemini-2.5-pro"],
  defaultModel: "auto",
  permissionModes: ["readOnly", "default", "acceptEdits"],
  conversational: true,
  resumable: true,
  supportsShellTools: true,
  lifecycle: "external_daemon",
};

export class OpenClawRuntime implements AgentRuntime {
  readonly id = "openclaw" as const;
  readonly displayName = "OpenClaw";
  readonly capabilities = CAPABILITIES;

  async detect(): Promise<DetectResult> {
    try {
      const ver = spawnSync("openclaw", ["--version"], { encoding: "utf-8", timeout: 3000 });
      if (ver.status !== 0) {
        return { error: "openclaw CLI not installed — `npm i -g openclaw`" };
      }
      const version = (ver.stdout || ver.stderr).trim().split("\n")[0] ?? null;
      // Daemon liveness. The CLI is a local RPC client; if the
      // gateway isn't up, every `openclaw agent` call hangs/fails.
      // Distinguishing "binary present, daemon down" from "binary
      // missing" lets the UI tell the user EXACTLY which step they
      // missed (onboard vs install).
      const gw = spawnSync("openclaw", ["gateway", "status"], { encoding: "utf-8", timeout: 2000 });
      if (gw.status !== 0) {
        return {
          binary: "openclaw",
          version,
          authed: false,
          authMethod: "none",
          error: "openclaw gateway not running — run `openclaw onboard --install-daemon`",
        };
      }
      // "authed=true" here means "daemon reachable" — provider auth
      // is the daemon's responsibility. If the daemon's provider key
      // is invalid, send() fails with exit code 1 + an error line
      // that the exit listener surfaces to the user.
      return { binary: "openclaw", version, authed: true, authMethod: "none" };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  spawn(opts: SpawnOpts): RuntimeSession {
    return new OpenClawSession(opts);
  }
}

// ── Permission → OpenClaw "thinking" level mapping ──
//
// OpenClaw doesn't have a permission model in the Claude sense; it has
// a `--thinking` flag that gates how aggressively the daemon takes
// actions. Best effort mapping until smoke test reveals true semantics.
function mapThinking(mode: PermissionMode): "low" | "medium" | "high" {
  switch (mode) {
    case "readOnly": return "low";
    case "default": return "medium";
    case "acceptEdits": return "high";
    case "bypassPermissions": return "high";
  }
}

// ── Tool-call describer (matches ClaudeRuntime's pattern) ──
//
// Maps OpenClaw's tool-use events to short, user-facing labels for
// the activity feed. Unknown tools fall through to a generic label;
// no event is ever dropped because it doesn't match our table.
//
// SMOKE TEST REQUIRED — names below are educated guesses from the
// OpenClaw README's "multi-channel routing + agent" framing. Verify
// by capturing a real `openclaw agent --message X --json` transcript.
function describeOpenClawTool(name: string, input: Record<string, unknown>): {
  label: string;
  detail: string;
} {
  switch (name) {
    case "shell":
    case "bash":      return { label: "Running command", detail: String(input.command || "").slice(0, 80) };
    case "read_file": return { label: "Reading file",    detail: String(input.path || "").slice(0, 80) };
    case "write_file":return { label: "Writing file",    detail: String(input.path || "").slice(0, 80) };
    case "edit_file": return { label: "Editing file",    detail: String(input.path || "").slice(0, 80) };
    case "web_search":return { label: "Searching web",   detail: String(input.query || "").slice(0, 80) };
    case "web_fetch": return { label: "Fetching URL",    detail: String(input.url || "").slice(0, 80) };
    case "grep":      return { label: "Searching code",  detail: String(input.pattern || "").slice(0, 80) };
    case "message_send": return { label: "Sending message", detail: String(input.target || "").slice(0, 80) };
    default:          return { label: `Running ${name}`, detail: "" };
  }
}

// ── Event parser ──
//
// Assumed shapes (SMOKE TEST REQUIRED):
//   {"type":"thread.started","thread":"thr_xxx"}
//   {"type":"reasoning","text":"…"}
//   {"type":"agent_message","text":"…","replaces":true}
//   {"type":"tool_use","name":"shell","input":{...}}
//   {"type":"tool_result","name":"shell","output":"…"}
//   {"type":"turn.completed","sessionId":"thr_xxx","usage":{...}}
//   {"type":"error","message":"…"}
//
// If the real grammar differs (likely it will in the details), update
// THIS function — the rest of the file is stable.
interface ParsedEvent {
  type: string;
  threadId?: string;
  text?: string;
  replaces?: boolean;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  error?: string;
}

function parseOpenClawEvent(line: string): ParsedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>;
    const type = String(raw.type ?? raw.event ?? "");
    if (!type) return null;
    return {
      type,
      threadId: typeof raw.thread === "string" ? raw.thread
        : typeof raw.threadId === "string" ? raw.threadId
        : typeof raw.sessionId === "string" ? raw.sessionId
        : undefined,
      text: typeof raw.text === "string" ? raw.text : undefined,
      replaces: typeof raw.replaces === "boolean" ? raw.replaces : undefined,
      toolName: typeof raw.name === "string" ? raw.name : undefined,
      toolInput: typeof raw.input === "object" && raw.input !== null
        ? raw.input as Record<string, unknown>
        : undefined,
      error: typeof raw.message === "string" && type === "error" ? raw.message : undefined,
    };
  } catch {
    // Non-JSON line — possibly a banner or human-readable status from
    // `openclaw` boot. Ignore silently; the user-facing channel for
    // these is stderr + the exit code.
    return null;
  }
}

function toActivityEvent(ev: ParsedEvent): ActivityEvent | null {
  switch (ev.type) {
    case "thread.started":
    case "session.started":
      return null;     // captured via threadId for resumeKey, no UI event
    case "agent_message":
    case "text":
      if (!ev.text) return null;
      // `replaces:true` mirrors Claude's behavior where successive
      // streaming chunks replace the previous one rather than append.
      // Default false matches Codex (append-only deltas).
      return { kind: "text", text: ev.text, replaces: ev.replaces ?? false };
    case "reasoning":
      if (!ev.text) return null;
      // Use the lighter `thinking` kind for free-form reasoning —
      // `working` requires a concrete tool name. Reasoning isn't a
      // tool call, just a "model is thinking" indicator.
      return { kind: "thinking" };
    case "tool_use":
    case "tool_call":
      if (!ev.toolName) return null;
      {
        const { label, detail } = describeOpenClawTool(ev.toolName, ev.toolInput ?? {});
        return { kind: "working", label, detail, tool: ev.toolName };
      }
    case "turn.completed":
    case "turn_complete":
      // ActivityEvent requires sessionId: string (non-null). If the
      // daemon never gave us a thread id, swallow the turn-complete
      // — the AgentManager treats missing turn-complete as "still
      // streaming" which is correct: without an id we can't resume.
      if (!ev.threadId) return null;
      return { kind: "turn_complete", sessionId: ev.threadId };
    case "error":
      return { kind: "error", message: ev.error ?? "openclaw reported an error", reason: classifyError(ev.error ?? "") };
    default:
      return null;
  }
}

function classifyError(msg: string): "auth" | "rate_limit" | "network" | "budget" | "not_installed" | "permission_denied" | "spawn_failed" | "other" {
  const m = msg.toLowerCase();
  if (/unauthor|invalid.*key|expired/i.test(m)) return "auth";
  if (/rate.?limit|429|too many/i.test(m)) return "rate_limit";
  if (/network|timeout|enotfound|econnref/i.test(m)) return "network";
  if (/quota|budget|exceeded/i.test(m)) return "budget";
  if (/permission|denied/i.test(m)) return "permission_denied";
  return "other";
}

// ── NDJSON line buffer (shared pattern with ClaudeRuntime) ──
function consumeLines(buf: string, setRest: (rest: string) => void): string[] {
  const lines: string[] = [];
  let i = 0;
  while (true) {
    const nl = buf.indexOf("\n", i);
    if (nl === -1) break;
    lines.push(buf.slice(i, nl));
    i = nl + 1;
  }
  setRest(buf.slice(i));
  return lines;
}

class OpenClawSession implements RuntimeSession {
  // OpenClaw spawns per turn — there is no stable PID across the
  // session's lifetime. Match Codex's `pid: null` convention.
  readonly pid: number | null = null;
  private resumeKey: string | null = null;
  private listeners: { activity: ActivityListener[]; exit: ExitListener[] } = {
    activity: [],
    exit: [],
  };
  private currentProc: ChildProcess | null = null;
  private aborted = false;

  constructor(private opts: SpawnOpts) {
    // Hydrate resume key from prior session if caller supplied one.
    // First send() will pass it via --thread; daemon resumes the
    // conversation by ID.
    if (opts.resumeKey) this.resumeKey = opts.resumeKey;
  }

  async send(text: string): Promise<void> {
    if (this.aborted) throw new Error("session shut down");
    // SMOKE TEST REQUIRED — exact arg names:
    //   --message <text>    | possibly --prompt or positional
    //   --thread <id>       | possibly --resume or --session
    //   --system <text>     | possibly --system-prompt
    //   --model <name>      | confirmed by README
    //   --thinking <level>  | confirmed by README
    //   --json              | confirmed by README ("structured output")
    const args = ["agent", "--message", text];
    if (this.resumeKey) args.push("--thread", this.resumeKey);
    if (this.opts.systemPrompt) args.push("--system", this.opts.systemPrompt);
    if (this.opts.model && this.opts.model !== "auto") args.push("--model", this.opts.model);
    args.push("--thinking", mapThinking(this.opts.permissionMode));
    args.push("--json");

    const proc = spawn("openclaw", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.opts.workDir,
      env: this.opts.env,
    });
    this.currentProc = proc;

    let buf = "";
    let stderrBuf = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      for (const line of consumeLines(buf, (rest) => { buf = rest; })) {
        const parsed = parseOpenClawEvent(line);
        if (!parsed) continue;
        if (parsed.threadId && !this.resumeKey) {
          this.resumeKey = parsed.threadId;
        }
        const ev = toActivityEvent(parsed);
        if (ev) this.listeners.activity.forEach(cb => cb(ev));
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf-8");
    });

    await new Promise<void>((resolve, reject) => {
      proc.on("error", reject);
      proc.on("close", (code) => {
        this.currentProc = null;
        // Surface stderr-only failures as an error activity event
        // so the user sees something concrete instead of a silent
        // exit.
        if (code !== 0 && stderrBuf.trim()) {
          this.listeners.activity.forEach(cb => cb({
            kind: "error",
            message: stderrBuf.trim().slice(0, 500),
            reason: classifyError(stderrBuf),
          }));
        }
        this.listeners.exit.forEach(cb => cb(code));
        if (code === 0) resolve();
        else reject(new Error(`openclaw exit ${code}: ${stderrBuf.trim().slice(0, 200)}`));
      });
    });
  }

  on(event: "activity", cb: ActivityListener): () => void;
  on(event: "exit", cb: ExitListener): () => void;
  on(event: "activity" | "exit", cb: ActivityListener | ExitListener): () => void {
    const arr = event === "activity"
      ? this.listeners.activity
      : this.listeners.exit;
    arr.push(cb as never);
    return () => {
      const i = arr.indexOf(cb as never);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  getResumeKey(): string | null {
    return this.resumeKey;
  }

  async shutdown(): Promise<void> {
    this.aborted = true;
    if (this.currentProc && !this.currentProc.killed) {
      // SIGTERM gives the CLI a chance to finalise output. The bridge's
      // outer wallclock kill (agent-manager) will SIGKILL if needed.
      this.currentProc.kill("SIGTERM");
    }
  }
}

// Exports for tests
export { parseOpenClawEvent, describeOpenClawTool, mapThinking, classifyError, consumeLines };

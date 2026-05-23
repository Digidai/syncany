/**
 * HermesRuntime — wraps the user's installed `hermes` CLI (Nous
 * Research's self-improving agent with persistent memory + skills).
 *
 * Trust model — identical to ClaudeRuntime / CodexRuntime / OpenClaw:
 *   - Raltic does NOT bundle hermes. User installs it themselves.
 *   - The daemon owns provider auth (300+ models via its router) +
 *     persistent memory + auto-created skills. Raltic never sees
 *     the provider keys.
 *   - Bridge shells out to `hermes agent --message <text> --json`
 *     per turn (the daemon does the LLM work; the CLI is a thin RPC
 *     client over Hermes' Unix socket).
 *
 * Lifecycle: external_daemon. detect() probes binary AND daemon via
 * `hermes status --json` so the UI can distinguish "not installed"
 * vs "installed but daemon stopped".
 *
 * Hermes-specific events vs. OpenClaw:
 *   - `skill.start` / `skill_invoke`: Hermes auto-creates skills
 *     mid-conversation. Surface as `working` with "Using skill: …".
 *   - `memory_recall`: Hermes pulls from persistent memory; surface
 *     as `working` so the user knows the agent is grounding in past
 *     context rather than generating from scratch.
 *
 * ⚠️ SMOKE TEST REQUIRED before shipping — the event grammar below is
 * derived from Hermes Agent's landing-page docs + Nous Research's
 * blog posts. Replace `parseHermesEvent` once real samples land in
 * docs/SAMPLES_hermes.jsonl.
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
  models: ["auto"],
  defaultModel: "auto",
  permissionModes: ["readOnly", "default", "acceptEdits"],
  conversational: true,
  resumable: true,
  supportsShellTools: true,
  lifecycle: "external_daemon",
};

export class HermesRuntime implements AgentRuntime {
  readonly id = "hermes" as const;
  readonly displayName = "Hermes Agent";
  readonly capabilities = CAPABILITIES;

  async detect(): Promise<DetectResult> {
    try {
      const ver = spawnSync("hermes", ["--version"], { encoding: "utf-8", timeout: 3000 });
      if (ver.status !== 0) {
        return {
          error: "hermes CLI not installed — `curl -sSL https://hermes-agent.nousresearch.com/install.sh | sh`",
        };
      }
      const version = (ver.stdout || ver.stderr).trim().split("\n")[0] ?? null;
      const st = spawnSync("hermes", ["status", "--json"], { encoding: "utf-8", timeout: 2000 });
      if (st.status !== 0) {
        return {
          binary: "hermes",
          version,
          authed: false,
          authMethod: "none",
          error: "hermes daemon not running — try `hermes start`",
        };
      }
      return { binary: "hermes", version, authed: true, authMethod: "none" };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  spawn(opts: SpawnOpts): RuntimeSession {
    return new HermesSession(opts);
  }
}

// ── Permission → Hermes autonomy level ──
//
// SMOKE TEST REQUIRED — actual Hermes CLI flag for permission gating
// unknown offline. Common pattern: --mode <level>. Refine after
// `hermes agent --help` capture.
function mapPermissionMode(mode: PermissionMode): string {
  switch (mode) {
    case "readOnly": return "readonly";
    case "default": return "confirm";
    case "acceptEdits": return "auto";
    case "bypassPermissions": return "auto";
  }
}

// ── Hermes tool / skill describer ──
function describeHermesTool(name: string, input: Record<string, unknown>): {
  label: string;
  detail: string;
} {
  switch (name) {
    case "shell":
    case "exec":       return { label: "Running command", detail: String(input.command || input.cmd || "").slice(0, 80) };
    case "read":
    case "read_file":  return { label: "Reading file",    detail: String(input.path || input.file || "").slice(0, 80) };
    case "write":
    case "write_file": return { label: "Writing file",    detail: String(input.path || input.file || "").slice(0, 80) };
    case "edit":
    case "patch":      return { label: "Editing file",    detail: String(input.path || input.file || "").slice(0, 80) };
    case "search":
    case "grep":       return { label: "Searching code",  detail: String(input.query || input.pattern || "").slice(0, 80) };
    case "browse":
    case "web":        return { label: "Browsing web",    detail: String(input.url || "").slice(0, 80) };
    case "memory":
    case "recall":     return { label: "Recalling memory", detail: String(input.query || "").slice(0, 80) };
    default:           return { label: `Running ${name}`, detail: "" };
  }
}

interface ParsedEvent {
  type: string;
  threadId?: string;
  text?: string;
  replaces?: boolean;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  skillName?: string;
  error?: string;
}

function parseHermesEvent(line: string): ParsedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>;
    const type = String(raw.type ?? raw.event ?? raw.kind ?? "");
    if (!type) return null;
    return {
      type,
      threadId: typeof raw.session === "string" ? raw.session
        : typeof raw.sessionId === "string" ? raw.sessionId
        : typeof raw.thread === "string" ? raw.thread
        : undefined,
      text: typeof raw.text === "string" ? raw.text
        : typeof raw.content === "string" ? raw.content
        : undefined,
      replaces: typeof raw.replaces === "boolean" ? raw.replaces : undefined,
      toolName: typeof raw.tool === "string" ? raw.tool
        : typeof raw.name === "string" ? raw.name
        : undefined,
      toolInput: typeof raw.input === "object" && raw.input !== null
        ? raw.input as Record<string, unknown>
        : typeof raw.args === "object" && raw.args !== null
        ? raw.args as Record<string, unknown>
        : undefined,
      skillName: typeof raw.skill === "string" ? raw.skill : undefined,
      error: typeof raw.message === "string" && type === "error" ? raw.message
        : typeof raw.error === "string" ? raw.error
        : undefined,
    };
  } catch {
    return null;
  }
}

function toActivityEvent(ev: ParsedEvent): ActivityEvent | null {
  switch (ev.type) {
    case "session.started":
    case "thread.started":
      return null;
    case "message":
    case "agent_message":
    case "text":
    case "response":
      if (!ev.text) return null;
      return { kind: "text", text: ev.text, replaces: ev.replaces ?? false };
    case "thinking":
    case "reasoning":
      return { kind: "thinking" };
    case "tool_use":
    case "tool_call":
    case "tool.start":
      if (!ev.toolName) return null;
      {
        const { label, detail } = describeHermesTool(ev.toolName, ev.toolInput ?? {});
        return { kind: "working", label, detail, tool: ev.toolName };
      }
    case "skill.start":
    case "skill_invoke":
      if (!ev.skillName) return null;
      return { kind: "working", label: `Using skill: ${ev.skillName}`, detail: "", tool: `skill:${ev.skillName}` };
    case "memory_recall":
    case "memory.recall":
      return { kind: "working", label: "Recalling memory", detail: ev.text?.slice(0, 80) ?? "", tool: "memory" };
    case "turn.completed":
    case "turn_complete":
    case "complete":
      if (!ev.threadId) return null;
      return { kind: "turn_complete", sessionId: ev.threadId };
    case "error":
      return {
        kind: "error",
        message: ev.error ?? "hermes reported an error",
        reason: classifyError(ev.error ?? ""),
      };
    default:
      return null;
  }
}

function classifyError(msg: string): "auth" | "rate_limit" | "network" | "budget" | "not_installed" | "permission_denied" | "spawn_failed" | "other" {
  const m = msg.toLowerCase();
  if (/unauthor|invalid.*key|expired|api.*key/i.test(m)) return "auth";
  if (/rate.?limit|429|too many/i.test(m)) return "rate_limit";
  if (/network|timeout|enotfound|econnref/i.test(m)) return "network";
  if (/quota|budget|exceeded|insufficient/i.test(m)) return "budget";
  if (/permission|denied|forbidden/i.test(m)) return "permission_denied";
  return "other";
}

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

class HermesSession implements RuntimeSession {
  readonly pid: number | null = null;
  private resumeKey: string | null = null;
  private listeners: { activity: ActivityListener[]; exit: ExitListener[] } = {
    activity: [],
    exit: [],
  };
  private currentProc: ChildProcess | null = null;
  private aborted = false;

  constructor(private opts: SpawnOpts) {
    if (opts.resumeKey) this.resumeKey = opts.resumeKey;
  }

  async send(text: string): Promise<void> {
    if (this.aborted) throw new Error("session shut down");
    const args = ["agent", "--message", text];
    if (this.resumeKey) args.push("--session", this.resumeKey);
    if (this.opts.systemPrompt) args.push("--system", this.opts.systemPrompt);
    args.push("--mode", mapPermissionMode(this.opts.permissionMode));
    args.push("--json");

    const proc = spawn("hermes", args, {
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
        const parsed = parseHermesEvent(line);
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
        if (code !== 0 && stderrBuf.trim()) {
          this.listeners.activity.forEach(cb => cb({
            kind: "error",
            message: stderrBuf.trim().slice(0, 500),
            reason: classifyError(stderrBuf),
          }));
        }
        this.listeners.exit.forEach(cb => cb(code));
        if (code === 0) resolve();
        else reject(new Error(`hermes exit ${code}: ${stderrBuf.trim().slice(0, 200)}`));
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
      this.currentProc.kill("SIGTERM");
    }
  }
}

export { parseHermesEvent, describeHermesTool, mapPermissionMode, classifyError, consumeLines };

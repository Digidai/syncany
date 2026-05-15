import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
import { spawn, ChildProcess } from "child_process";
import type { BridgeConnectResponse, MessageRow } from "@syncany/protocol";
import { buildSystemPrompt } from "./system-prompt.js";

type AgentActivity = "idle" | "thinking" | "working" | "error";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface AgentSession {
  id: string;
  name: string;
  displayName: string;
  workDir: string;
  systemPrompt: string | null;
  model: "opus" | "sonnet" | "haiku";
}

interface QueuedMessage {
  userMessage: string;
  resolve: () => void;
  reject: (err: Error) => void;
}

interface AgentProcess {
  proc: ChildProcess;
  sessionId: string | null;
  busy: boolean;
  stdoutBuffer: string;
  pendingText: string;
  messageQueue: QueuedMessage[];
}

interface AgentManagerOpts {
  apiUrl: string;
  agentsDir: string;
}

/**
 * Spawns and manages Claude Code subprocesses, one per agent.
 * Each process gets:
 *   - Its own workspace directory (~/.syncany/agents/<agent_id>/)
 *   - A `syncany` CLI wrapper that injects per-agent auth env vars
 *   - A persistent session_id stored in the workspace
 *
 * Inbound messages from the Bridge's WS subscriptions are dispatched
 * to the matching agent's stdin (queued if the agent is mid-turn).
 */
export class AgentManager {
  private sessions = new Map<string, AgentSession>();
  private processes = new Map<string, AgentProcess>();
  /** channelId → list of agentIds that should respond to messages in this channel */
  private channelToAgents = new Map<string, string[]>();
  private apiUrl: string;
  private agentsDir: string;
  private boot: BridgeConnectResponse | null = null;

  constructor(opts: AgentManagerOpts) {
    this.apiUrl = opts.apiUrl;
    this.agentsDir = opts.agentsDir;
    if (!existsSync(opts.agentsDir)) mkdirSync(opts.agentsDir, { recursive: true });
  }

  setBootContext(boot: BridgeConnectResponse): void {
    this.boot = boot;
    this.channelToAgents.clear();
    for (const ch of boot.channels) {
      this.channelToAgents.set(ch.id, ch.agentIds);
    }
  }

  async initAllAgents(agents: BridgeConnectResponse["agents"]): Promise<void> {
    for (const a of agents) {
      const workDir = join(this.agentsDir, a.id);
      if (!existsSync(workDir)) {
        mkdirSync(workDir, { recursive: true });
        mkdirSync(join(workDir, "notes"), { recursive: true });
        const memoryContent =
`# ${a.displayName}

## Role
${a.displayName}

## Key Knowledge
- No notes saved yet.

## Active Context
- Workspace initialized at ${new Date().toISOString().split("T")[0]}.
`;
        writeFileSync(join(workDir, "MEMORY.md"), memoryContent);
        console.log(`  [${a.displayName}] workspace created: ${workDir}`);
      }
      this.sessions.set(a.id, {
        id: a.id, name: a.name, displayName: a.displayName,
        workDir, systemPrompt: a.systemPrompt, model: a.model,
      });
    }
  }

  /** Called by Bridge when a human message lands in a channel one of our agents is in. */
  async dispatchInboundMessage(channelId: string, message: MessageRow): Promise<void> {
    const agentIds = this.channelToAgents.get(channelId);
    if (!agentIds || agentIds.length === 0) return;
    // Naive: every agent in the channel sees the message. UX filters
    // (e.g. only @mentioned) can layer on top in system prompt.
    for (const agentId of agentIds) {
      try { await this.sendToAgent(agentId, message.content); }
      catch (e) { console.error(`[agent ${agentId}] dispatch failed:`, e); }
    }
  }

  async sendToAgent(agentId: string, userMessage: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) throw new Error(`agent ${agentId} not initialized`);

    let memoryContext = "";
    const memoryPath = join(session.workDir, "MEMORY.md");
    if (existsSync(memoryPath)) memoryContext = readFileSync(memoryPath, "utf-8");

    const systemPrompt = buildSystemPrompt(
      { id: session.id, name: session.name, display_name: session.displayName,
        description: null, system_prompt: session.systemPrompt,
        model: session.model, status: "online" } as any,
      memoryContext,
    );

    let agentProc = this.processes.get(agentId);
    if (!agentProc || agentProc.proc.killed || agentProc.proc.exitCode !== null) {
      agentProc = await this.spawnProcess(agentId, session, systemPrompt, session.model);
      this.processes.set(agentId, agentProc);
    }

    if (agentProc.busy) {
      console.log(`  [${session.displayName}] busy, queueing (${userMessage.length} chars; queue ${agentProc.messageQueue.length + 1})`);
      return new Promise<void>((resolve, reject) => {
        agentProc!.messageQueue.push({ userMessage, resolve, reject });
      });
    }

    this.deliverMessage(agentId, agentProc, session, userMessage);
  }

  private deliverMessage(agentId: string, agentProc: AgentProcess, session: AgentSession, userMessage: string): void {
    agentProc.busy = true;
    const stdinMsg = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: userMessage }] },
      ...(agentProc.sessionId ? { session_id: agentProc.sessionId } : {}),
    });
    console.log(`  [${session.displayName}] forwarding (${userMessage.length} chars)`);
    this.broadcastActivity(agentId, "working", "Working", "Message received");
    agentProc.proc.stdin?.write(stdinMsg + "\n");
  }

  private drainQueue(agentId: string, agentProc: AgentProcess): void {
    const session = this.sessions.get(agentId);
    if (!session) return;
    const next = agentProc.messageQueue.shift();
    if (!next) return;
    console.log(`  [${session.displayName}] draining queue (${agentProc.messageQueue.length} remaining)`);
    this.deliverMessage(agentId, agentProc, session, next.userMessage);
    next.resolve();
  }

  private async restartProcess(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) return;
    const agentProc = this.processes.get(agentId);
    if (!agentProc) return;

    const pending = [...agentProc.messageQueue];
    agentProc.messageQueue = [];
    if (!agentProc.proc.killed) agentProc.proc.kill();

    let memoryContext = "";
    const memoryPath = join(session.workDir, "MEMORY.md");
    if (existsSync(memoryPath)) memoryContext = readFileSync(memoryPath, "utf-8");

    const systemPrompt = buildSystemPrompt(
      { id: session.id, name: session.name, display_name: session.displayName,
        description: null, system_prompt: session.systemPrompt,
        model: session.model, status: "online" } as any,
      memoryContext,
    );
    const newProc = await this.spawnProcess(agentId, session, systemPrompt, session.model);
    newProc.messageQueue = pending;
    this.processes.set(agentId, newProc);
    console.log(`  [${session.displayName}] process restarted with fresh MEMORY.md`);
  }

  /**
   * Write a `syncany` wrapper script + env file into <workDir>/.syncany so the
   * agent's shell can invoke `syncany message send` etc.
   * Returns the .syncany/ dir path (to prepend to PATH).
   */
  private prepareCliTransport(agentId: string, session: AgentSession): string {
    if (!this.boot) throw new Error("boot context not set");
    const syncanyDir = join(session.workDir, ".syncany");
    if (!existsSync(syncanyDir)) mkdirSync(syncanyDir, { recursive: true });

    const wrapperPath = join(syncanyDir, "syncany");
    const require = createRequire(import.meta.url);
    let wrapperBody = "";
    let resolved = "";
    try {
      resolved = require.resolve("@syncany/cli");
    } catch {
      // Fall through to monorepo dev path below.
    }
    if (resolved) {
      wrapperBody = `#!/usr/bin/env bash\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${resolved.replace(/'/g, "'\\''")}' "$@"\n`;
    } else {
      // Monorepo dev fallback (no installed package).
      const bridgeRoot = resolve(__dirname, "..");
      const cliPath = resolve(bridgeRoot, "..", "..", "packages", "cli", "src", "index.ts");
      const tsxPath = join(bridgeRoot, "node_modules", "tsx", "dist", "cli.mjs");
      wrapperBody = `#!/usr/bin/env bash\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${tsxPath.replace(/'/g, "'\\''")}' '${cliPath.replace(/'/g, "'\\''")}' "$@"\n`;
    }
    writeFileSync(wrapperPath, wrapperBody, { mode: 0o755 });
    return syncanyDir;
  }

  private async spawnProcess(
    agentId: string,
    session: AgentSession,
    systemPrompt: string,
    model: "opus" | "sonnet" | "haiku",
  ): Promise<AgentProcess> {
    if (!this.boot) throw new Error("boot context not set");

    const syncanyDir = this.prepareCliTransport(agentId, session);

    // Permission mode: default to "acceptEdits" (file edits inside cwd are
    // auto-approved, shell commands still prompt). The aggressive
    // "bypassPermissions" mode is opt-in via env because it grants the agent
    // unrestricted shell on the user's laptop — any chat message it sees
    // can become RCE on the bridge host.
    //
    //   SYNCANY_BRIDGE_PERMISSION_MODE=bypassPermissions   # legacy / lab
    //   SYNCANY_BRIDGE_PERMISSION_MODE=acceptEdits          # default
    //   SYNCANY_BRIDGE_PERMISSION_MODE=default              # prompt for everything
    const permMode = (process.env.SYNCANY_BRIDGE_PERMISSION_MODE ?? "acceptEdits").trim();
    const allowedModes = new Set(["default", "acceptEdits", "bypassPermissions"]);
    const effectiveMode = allowedModes.has(permMode) ? permMode : "acceptEdits";
    if (effectiveMode === "bypassPermissions") {
      console.warn(`  [${session.displayName}] WARNING: bypassPermissions enabled — agent has unrestricted shell on this host. Any message it sees can run arbitrary code.`);
    }

    const args = [
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--append-system-prompt", systemPrompt,
      "--permission-mode", effectiveMode,
      "--model", model,
    ];

    const prevProc = this.processes.get(agentId);
    const sessionId = prevProc?.sessionId || (await this.loadSessionId(session));
    if (sessionId) args.push("--resume", sessionId);

    console.log(`  [${session.displayName}] spawning Claude Code (${sessionId ? "resume " + sessionId.slice(0, 8) : "new session"})`);

    const proc = spawn("claude", args, {
      cwd: session.workDir,
      env: {
        ...process.env,
        FORCE_COLOR: "0", NO_COLOR: "1",
        SYNCANY_AGENT_ID: agentId,
        SYNCANY_API_URL: this.apiUrl,
        SYNCANY_AGENT_TOKEN: this.boot.token, // shared bridge token; api derives agent identity from `as` field
        PATH: `${syncanyDir}:${process.env.PATH ?? ""}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const agentProc: AgentProcess = {
      proc,
      sessionId: prevProc?.sessionId || null,
      busy: false,
      stdoutBuffer: "",
      pendingText: "",
      messageQueue: [],
    };

    this.broadcastActivity(agentId, "working", "Working", "Starting…");

    proc.stdout?.on("data", (chunk: Buffer) => {
      agentProc.stdoutBuffer += chunk.toString();
      const lines = agentProc.stdoutBuffer.split("\n");
      agentProc.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleStreamEvent(agentId, agentProc, line.trim());
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      if (/Reconnecting\.\.\.|Falling back from WebSockets/i.test(text)) return;
      console.error(`  [${session.displayName}] stderr: ${text.substring(0, 200)}`);
    });

    proc.on("error", (err: Error) => {
      console.error(`  [${session.displayName}] process error: ${err.message}`);
    });

    proc.on("close", (code: number | null) => {
      console.log(`  [${session.displayName}] process exited code=${code}`);
      for (const queued of agentProc.messageQueue) queued.reject(new Error(`agent process exited with code ${code}`));
      agentProc.messageQueue = [];
    });

    return agentProc;
  }

  private handleStreamEvent(agentId: string, agentProc: AgentProcess, line: string): void {
    let event: any;
    try { event = JSON.parse(line); } catch { return; }
    const session = this.sessions.get(agentId);
    const displayName = session?.displayName || agentId;

    switch (event.type) {
      case "system":
        if (event.subtype === "init" && event.session_id) {
          agentProc.sessionId = event.session_id;
          this.saveSessionId(session!, event.session_id);
          console.log(`  [${displayName}] session initialized: ${event.session_id.substring(0, 8)}…`);
        }
        if (event.subtype === "compacting") {
          this.flushPendingText(agentId, agentProc);
          this.broadcastActivity(agentId, "working", "Optimizing context", "");
          this.restartProcess(agentId).catch((err) =>
            console.error(`  [${displayName}] restart after compaction failed: ${err.message}`));
        }
        break;
      case "assistant": {
        const block = event.message?.content?.[0];
        if (!block) break;
        if (block.type === "thinking") {
          this.flushPendingText(agentId, agentProc);
          this.broadcastActivity(agentId, "thinking", "Thinking", "");
        } else if (block.type === "text") {
          agentProc.pendingText = block.text || "";
        } else if (block.type === "tool_use") {
          this.flushPendingText(agentId, agentProc);
          const { label, detail } = describeToolUse(block);
          this.broadcastActivity(agentId, "working", label, detail);
        }
        break;
      }
      case "result": {
        this.flushPendingText(agentId, agentProc);
        if (event.session_id && session) {
          agentProc.sessionId = event.session_id;
          this.saveSessionId(session, event.session_id);
        }
        agentProc.busy = false;
        this.broadcastActivity(agentId, "idle", "Idle", "");
        console.log(`  [${displayName}] turn complete`);
        this.drainQueue(agentId, agentProc);
        break;
      }
    }
  }

  private flushPendingText(agentId: string, agentProc: AgentProcess): void {
    if (!agentProc.pendingText) return;
    const text = agentProc.pendingText.trim();
    if (text) this.broadcastActivity(agentId, "thinking", "", text);
    agentProc.pendingText = "";
  }

  private broadcastActivity(agentId: string, activity: AgentActivity, label = "", detail = ""): void {
    if (process.env.SYNCANY_BRIDGE_VERBOSE) {
      console.log(`  [activity ${agentId.slice(0, 8)}] ${activity} ${label} ${detail.slice(0, 80)}`);
    }
    if (!this.boot) return;
    // Fire-and-forget POST to api; don't block the stream-event handler.
    fetch(`${this.apiUrl}/api/v1/agent-activity`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer sy_bridge_${this.boot.token}`,
      },
      body: JSON.stringify({ agentId, status: activity, label, detail }),
    }).catch((e) => {
      if (process.env.SYNCANY_BRIDGE_VERBOSE) console.warn("activity POST failed:", e);
    });
  }

  /** Broadcast an online/offline lifecycle event for every tracked agent.
   *  Called from bridge.start (online) and bridge.stop (offline). Without
   *  this, the sidebar shows agents as "offline" after bridge connect
   *  because the only previous activity events were per-message. */
  public broadcastLifecycle(status: "idle" | "error"): void {
    if (!this.boot) return;
    for (const a of this.boot.agents) {
      this.broadcastActivity(a.id, status, status === "idle" ? "Online" : "Offline", "");
    }
  }

  private sessionIdPath(session: AgentSession): string {
    return join(session.workDir, ".syncany", "session_id");
  }
  private async saveSessionId(session: AgentSession, sessionId: string): Promise<void> {
    try {
      const dir = join(session.workDir, ".syncany");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.sessionIdPath(session), sessionId);
    } catch (e) { console.error(`[saveSessionId] ${e}`); }
  }
  private async loadSessionId(session: AgentSession): Promise<string | null> {
    try {
      const p = this.sessionIdPath(session);
      if (!existsSync(p)) return null;
      return readFileSync(p, "utf-8").trim() || null;
    } catch { return null; }
  }

  getWorkspaceDir(agentId: string): string | null {
    return this.sessions.get(agentId)?.workDir ?? null;
  }

  async shutdown(): Promise<void> {
    for (const [, agentProc] of this.processes) {
      for (const queued of agentProc.messageQueue) queued.reject(new Error("agent manager stopped"));
      agentProc.messageQueue = [];
      if (!agentProc.proc.killed) agentProc.proc.kill();
    }
    this.processes.clear();
  }
}

function describeToolUse(block: any): { label: string; detail: string } {
  const name = block?.name || "tool";
  const input = block?.input || {};
  switch (name) {
    case "Bash": return { label: "Running command", detail: String(input.command || "").slice(0, 80) };
    case "Read": return { label: "Reading file", detail: String(input.file_path || "").slice(0, 80) };
    case "Write": return { label: "Writing file", detail: String(input.file_path || "").slice(0, 80) };
    case "Edit": return { label: "Editing file", detail: String(input.file_path || "").slice(0, 80) };
    case "WebFetch": return { label: "Fetching URL", detail: String(input.url || "").slice(0, 80) };
    case "Grep": return { label: "Searching code", detail: String(input.pattern || "").slice(0, 80) };
    case "Glob": return { label: "Finding files", detail: String(input.pattern || "").slice(0, 80) };
    default: return { label: `Running ${name}`, detail: "" };
  }
}

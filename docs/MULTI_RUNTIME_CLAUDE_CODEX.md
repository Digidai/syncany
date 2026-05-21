# Multi-runtime bridge: Claude Code + Codex — detailed design (v2)

**Status:** post-review revision, ready for implementation  
**Scope:** ship `apps/bridge` support for two AI agent runtimes (Anthropic Claude Code + OpenAI Codex). OpenClaw / Hermes Agent **out of scope**.  
**Revision history:**
* v1 (2026-05-17): initial design.
* v2 (2026-05-17): integrates 9 rounds of independent review. Major corrections: SDK API shape verified against the actual `@openai/codex-sdk` source, permission-mode mapping rewritten to avoid daemon deadlocks, AGENTS.md strategy hardened, schema-change ordering tightened, runtime-availability moved off agent rows, time estimate revised to **8–11 days**, PR breakdown split to keep risk isolated.
* v3 (2026-05-17): adds **per-machine-key runtime visibility** in Settings + Setup Wizard. Schema gains a `machine_keys.last_detected_runtimes` JSON column; UI gains runtime badges on Machine API keys cards.
* **v4 (2026-05-17, this version):** integrates Agent Team review of the v3 changes (5 P0 + 9 P1 + internal inconsistencies). Major corrections: **(1)** snapshot is zod-parsed on both write (defends against bridge sending hostile JSON / XSS via `runtime.error` rendering) and read (defends against older-bridge shape drift); **(2)** `/connect` log payload redacts `authMethod` so observability doesn't leak "ChatGPT-OAuth vs env-key" fingerprint; **(3)** endpoint hard-scopes to `WHERE owner_user_id = ctx.user.id`; **(4)** snapshot keyed by `(machineKey × machineFingerprint)` not just `machineKey` so two laptops sharing a key don't overwrite each other; **(5)** new endpoint rate-limited + 2s in-Worker cache; **(6)** §6.5 pill states folded from 5/6 inconsistent ones to **4 unambiguous states** (Ready / Sign-in needed / Not installed / Offline) each with a **Lucide icon** (not just color — WCAG 1.4.1); **(7)** Settings card stacks vertically on mobile; **(8)** wizard runtime strip gated on `bridgeOnline === true` (not before); **(9)** wizard piggybacks on existing `listMachineKeys` poll via server-side join (no second poller); **(10)** dropped misleading "Onboarding empty state" row from §6.7. Adds 2 new test cases (XSS injection, log redaction). No timeline change.

---

## 0. Summary

Both runtimes expose a **multi-turn streaming session**, but via different underlying mechanisms:

* **Claude Code** is a single **persistent child process** (`claude --input-format stream-json --output-format stream-json`) that we keep alive and feed NDJSON over stdin.
* **Codex** uses the **`@openai/codex-sdk` Node package**. The SDK gives us a `Thread` object whose `runStreamed(prompt)` API *looks* persistent to us, but **internally spawns `codex exec` per turn** and resumes via the on-disk session file at `~/.codex/sessions/<id>.jsonl`. State persists across turns; the process does not.

Both fit a unified `RuntimeSession.send(text)` interface — `AgentManager` doesn't see the lifecycle difference. The adapters absorb it.

**Decision:** ship a `packages/agent-runtime/` abstraction. ClaudeRuntime is a code-move of the existing bridge logic. CodexRuntime wraps the SDK with corrections from §4 below. Schema + UI changes are small but tightly-ordered.

**Revised estimate: 8–11 engineering days** end-to-end with the test coverage in §10. v1's 5–8 underbid the SDK-reality buffer + the PR ordering refactor.

---

## 1. Side-by-side: what each runtime gives us

| Concern | Claude Code | Codex |
|---|---|---|
| **Long-lived multi-turn session API** | Spawn `claude --input-format stream-json --output-format stream-json` once; write NDJSON to stdin per turn; read NDJSON events from stdout. **Process persists across turns.** | `const thread = codex.startThread(opts); { events } = await thread.runStreamed(prompt)`. **Thread object persists but the SDK spawns `codex exec` per turn**; session state lives in `~/.codex/sessions/<id>.jsonl`. |
| **stdin format for next user message** | `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}` | `await thread.runStreamed("…plain prompt…")` — SDK abstracts the wire format. |
| **stdout event stream** | NDJSON: `{type:"system",subtype:"init",session_id}`, `{type:"assistant",message:{content:[{type:"thinking"\|"text"\|"tool_use", …}]}}`, `{type:"result",session_id}` | `runStreamed()` returns `Promise<StreamedTurn>` where `StreamedTurn.events` is an `AsyncGenerator<ThreadEvent>`. Event types: `thread.started`, `turn.started`, `item.started`, `item.completed` (with `item.type` of `reasoning` \| `agent_message` \| `command_execution` \| `file_change` \| `mcp_tool_call` \| `web_search`), `turn.completed` with `usage`. |
| **Session resume** | `--resume <session_id>` flag; we read `session_id` from `system.init` event and persist to disk. | `codex.resumeThread(threadId, threadOptions)`; threadId surfaced via the `thread.started` event mid-stream (NOT `thread.id` after the loop). Sessions also persisted by Codex at `~/.codex/sessions/*.jsonl`. |
| **System prompt** | `--append-system-prompt "…"` flag, sent per process spawn. | No flag. Codex reads `AGENTS.md` from cwd + walked-up tree + global `~/.codex/AGENTS.md`. Bridge writes per-agent `AGENTS.md` to the agent's workDir **on every spawn** (defends against manual deletion + ancestor leak; see §4.3). |
| **Tool allowlist** | `--allowedTools "Read,Glob,Grep,WebSearch,WebFetch,Bash(raltic …)"` | `sandboxMode` + `approvalPolicy` (process-level); no per-command allowlist. Custom tools via MCP servers in `~/.codex/config.toml`. |
| **Shell access (for `raltic` CLI)** | `Bash` tool, gated by `--allowedTools` patterns. We grant `Bash(raltic …:*)`. | Built-in shell tool, gated by sandbox level. We use `workspace-write` + `approvalPolicy: "never"` — see §4.1 for why "never" is required for daemon mode. |
| **Auth** | `claude` manages it: OAuth (Pro/Max) or `ANTHROPIC_API_KEY` env. Stored in `~/.claude/`. | `codex` manages it: OAuth (ChatGPT Plus/Pro) via `codex login` stored in `~/.codex/auth.json`, OR `CODEX_API_KEY` / `OPENAI_API_KEY` env. **`codex login status` only reflects OAuth**; env-key auth requires a separate env-var check (see §4.5). |
| **Model identifiers** | `opus`, `sonnet`, `haiku` (passed via `--model`) | `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex-spark` (Pro only). Passed via the `ThreadOptions.model` field. |
| **Permission UX (user-facing)** | 4 modes: `default` / `acceptEdits` / `bypassPermissions` + new `readOnly` | Maps to Codex sandbox + approval; **all daemon-mode mappings use `approvalPolicy: "never"`** to prevent hang-on-approval-prompt. |
| **Working directory contract** | Bridge passes `cwd: <agent-workDir>`. Claude has no git-repo requirement. | Codex defaults to requiring a git repo. **Must pass `skipGitRepoCheck: true`** on every `startThread()` / `resumeThread()`. |

---

## 2. Bridge architecture diff (today → target)

### 2.1 Today (`apps/bridge/src/agent-manager.ts` simplified)

Reference: `/Users/dai/Developer/CursorProjects/raltic/apps/bridge/src/agent-manager.ts`

```
class AgentManager {
  processes: Map<agentId, AgentProcess>   // { proc, sessionId, busy, stdoutBuffer, pendingText, messageQueue }
  spawnProcess(agentId, session, systemPrompt, model) {
    proc = spawn("claude", [...claudeArgs])
    proc.stdout.on("data", chunk => handleStreamEvent buffer-split, ndjson lines)
    return { proc, sessionId: null, busy: false, stdoutBuffer:"", pendingText:"", messageQueue:[] }
  }
  deliverMessage(agentId, text) {
    proc.stdin.write(JSON.stringify({type:"user", message:{...}}) + "\n")
  }
  handleStreamEvent(agentId, agentProc, line) {
    case "system": agentProc.sessionId = ev.session_id
    case "assistant": flushPendingText / set pendingText / report tool_use
    case "result": agentProc.busy = false; broadcastActivity("idle"); drainQueue
  }
}
```

### 2.2 Target

```
// packages/agent-runtime/src/types.ts
interface AgentRuntime {
  id: "claude" | "codex"
  displayName: string
  capabilities: RuntimeCapabilities
  detect(): Promise<DetectResult>
  spawn(opts: SpawnOpts): RuntimeSession
}

interface RuntimeSession {
  pid?: number                                         // claude has one; codex SDK does not
  send(text: string): Promise<void>                    // multi-turn: subsequent message
  on(event: "activity"|"exit"|"needs_restart", cb): void
  getResumeKey(): string | null
  shutdown(): Promise<void>
}

type ActivityEvent =
  | { kind: "thinking" }
  | { kind: "working"; tool: string; label: string; detail: string }
  | { kind: "text"; text: string; replaces: boolean }  // see §3.6 — Claude overwrites, Codex too
  | { kind: "turn_complete"; sessionId: string }
  | { kind: "needs_restart"; reason: "compacting" | "prompt_changed" | "error" }
  | { kind: "error"; message: string; reason?: "budget" | "auth" | "rate_limit" | "network" | "other" }

// packages/agent-runtime/src/claude.ts (extracted, near-zero behavior delta)
class ClaudeRuntime implements AgentRuntime { … }

// packages/agent-runtime/src/codex.ts (new, via @openai/codex-sdk)
class CodexRuntime implements AgentRuntime { … }


// apps/bridge/src/agent-manager.ts (slimmed)
class AgentManager {
  sessions: Map<agentId, SessionEntry>                 // { runtime, session, busy, messageQueue }
  async sendToAgent(agentId, message) {
    const entry = this.sessions.get(agentId) ?? await this.spawnForAgent(agentId)
    if (entry.busy) return entry.messageQueue.push(message)
    entry.busy = true
    await entry.session.send(this.formatInbound(message))
  }
}
```

`prepareCliTransport` (the `raltic` wrapper writer) **stays in `AgentManager`** — it's runtime-agnostic and both Claude and Codex inherit it via `env.PATH`. Verified per agent-manager.ts:263-282.

---

## 3. ClaudeRuntime adapter — extraction notes (per-line risks)

The current bridge code (`agent-manager.ts`) ships state across several private fields. The extraction must move them intact:

| Today's field | New location | Notes |
|---|---|---|
| `AgentProcess.proc` | `ClaudeSession#proc` | `pid` exposed read-only via interface. |
| `AgentProcess.sessionId` | `ClaudeSession#sessionId` | Captured synchronously inside `_onLine` on `system.init`; `getResumeKey()` returns this. |
| `AgentProcess.busy` | **`SessionEntry.busy` in AgentManager** | Queue lives at the AgentManager layer, NOT inside the session — the session has no concept of queueing. |
| `AgentProcess.stdoutBuffer` | `ClaudeSession#stdoutBuffer` | **Critical (Review 2 P0-1)** — partial NDJSON line buffer must survive across `data` events. Must be on the session instance. |
| `AgentProcess.pendingText` | `ClaudeSession#pendingText` | Today's `flushPendingText` is called from 4 branches (compacting, thinking, tool_use, result). Same lives inside `_onLine`. |
| `AgentProcess.messageQueue` | **`SessionEntry.messageQueue` in AgentManager** | Promise rejection on session exit (`proc.close` rejecter, agent-manager.ts:394-396) must move: AgentManager subscribes to `session.on("exit", ...)` and rejects all queued promises there. **Pitfall (Review 2 P0-2):** don't leave queue with session — orphans queued promises. |

### 3.1 Activity-emit ordering invariant (Review 2 P0-3)

Today `handleStreamEvent` mutates `agentProc.sessionId` synchronously *before* any external POST. The new design splits emit from POST: session emits `ActivityEvent`s; AgentManager subscribes + does the POST. Spec:

> **Invariant:** `session.getResumeKey()` MUST reflect the latest captured id at the moment of `emit()`. The session's `_onLine` must do `this.sessionId = ev.session_id` BEFORE `this._emit({kind:"turn_complete", sessionId: this.sessionId})`. Consumers querying `getResumeKey()` from the activity handler must see the updated id.

### 3.2 Compaction → restart trigger (Review 2 P1-5)

Today the bridge respawns Claude on `system.compacting` (agent-manager.ts:417). The new design adds `{kind:"needs_restart", reason:"compacting"}` to `ActivityEvent`. AgentManager subscribes + handles by shutting down + respawning. This is the same trigger for system-prompt edits.

### 3.3 Env enumeration (Review 2 P1-6)

`SpawnOpts.env` must include, at minimum:
```
RALTIC_AGENT_ID, RALTIC_API_URL, RALTIC_AGENT_TOKEN,
PATH (with ralticDir prepended via prepareCliTransport),
FORCE_COLOR=0, NO_COLOR=1
```
AgentManager builds the full env (it owns `prepareCliTransport`'s returned dir) and passes through. Both Claude and Codex need these — the `raltic` CLI wrapper is shared.

### 3.4 Resume-key sequencing (Review 2 P1-8)

When AgentManager respawns (compaction, prompt change), it MUST pass `opts.resumeKey = previousSession.getResumeKey()` BEFORE the new spawn replaces the old in the sessions map. Don't fall back to reading the on-disk session_id file — that lags by an async `saveSessionId` write.

### 3.5 `prepareCliTransport` stays runtime-agnostic (Review 2 P1-4 — verified)

It writes a bash wrapper around `@raltic/cli` and returns a PATH dir. No Claude-specific knowledge. Confirmed via agent-manager.ts:263-282.

### 3.6 `pendingText` is OVERWRITE not append (Review 2 P1-7)

`pendingText = block.text` (line 428) — overwrite, not concat. `ActivityEvent.kind: "text"` should be treated by consumers as **full-text replacement** of the last text frame, not delta. Adapter doc'd accordingly via `replaces: true`.

---

## 4. CodexRuntime adapter — verified against real SDK

**All SDK API shapes below are verified against `openai/codex` repo at `sdk/typescript/src/{codex,thread,items,events,codexOptions,threadOptions}.ts` (Review 1).**

### 4.1 Spawn — CORRECTED API

```ts
import { Codex } from "@openai/codex-sdk";

class CodexRuntime implements AgentRuntime {
  id = "codex" as const;
  displayName = "OpenAI Codex";

  capabilities = {
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex-spark"],
    // 4 modes now (added `readOnly` per Review 4 P1-6):
    permissionModes: ["readOnly", "default", "acceptEdits", "bypassPermissions"],
    resumable: true,
    conversational: true,
    supportsShellTools: true,
  };

  async detect(): Promise<DetectResult> {
    const timeout = 3000;
    try {
      const { stdout } = await execWithTimeout("codex", ["--version"], timeout);
      const version = stdout.trim();
      const oauthAuthed = await this._oauthAuthed(timeout);
      const envAuthed = !!(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY);
      return {
        binary: "codex",
        version,
        authed: oauthAuthed || envAuthed,
        authMethod: oauthAuthed ? "oauth" : envAuthed ? "env" : "none",
      };
    } catch (e) {
      return { error: `codex not installed or detect timed out: ${e}` };
    }
  }

  private async _oauthAuthed(timeout: number): Promise<boolean> {
    // codex login status returns 0 if authenticated via ChatGPT OAuth.
    // It does NOT cover CODEX_API_KEY env auth (Review 7 finding 2).
    try {
      const { code } = await execMaybe("codex", ["login", "status"], timeout);
      return code === 0;
    } catch { return false; }
  }

  spawn(opts: SpawnOpts): RuntimeSession {
    const codex = new Codex({
      env: opts.env,
      // The Codex constructor only accepts: codexPathOverride | baseUrl |
      // apiKey | config | env. `config` is a TOML-override bag, NOT typed
      // model/sandbox/approval — those belong on ThreadOptions below.
    });

    const threadOptions = {
      workingDirectory: opts.workDir,
      skipGitRepoCheck: true,         // our workDir is not a git repo
      model: opts.model,
      sandboxMode: this._sandboxFor(opts.permissionMode),     // camelCase, not snake_case
      approvalPolicy: this._approvalFor(opts.permissionMode),
    };

    const thread = opts.resumeKey
      ? codex.resumeThread(opts.resumeKey, threadOptions)   // CRITICAL: also accepts ThreadOptions
      : codex.startThread(threadOptions);

    return new CodexSession(thread, opts);
  }

  /**
   * Permission-mode mapping (Review 4 P0-1, P0-2).
   *
   * CRITICAL: every daemon mode uses `approvalPolicy: "never"`. With ANY
   * other approval policy, Codex emits approval-request events that no
   * human is listening for — the session HANGS waiting for an answer.
   *
   * What changes between modes is the SANDBOX (the capability surface),
   * not the approval policy.
   */
  private _sandboxFor(mode: string): "read-only" | "workspace-write" | "danger-full-access" {
    switch (mode) {
      case "readOnly":          return "read-only";
      case "default":           return "read-only";       // claude `default` ≈ codex `read-only + never`
      case "acceptEdits":       return "workspace-write";
      case "bypassPermissions": return "danger-full-access";
      default:                  return "workspace-write";
    }
  }
  private _approvalFor(_mode: string): "never" {
    return "never";  // ALWAYS never — sandbox is the actual gate.
  }
}
```

> **Mode semantics, written explicitly so users + reviewers agree:**
> * `readOnly` — Codex can read but never write. Write attempts surface as tool errors the model can recover from. Claude maps to `default` + a deny-write hook.
> * `default` — same as `readOnly` for Codex (the conservative interpretation; surfaced in UI tooltip). For Claude unchanged.
> * `acceptEdits` — writes inside `workDir` succeed silently; writes outside fail as sandbox-denied tool errors.
> * `bypassPermissions` — agent has unrestricted shell + filesystem. UI must show a Codex-specific warning string (Review 4 P1-5): "Codex `danger-full-access` disables the sandbox entirely, not just approvals — strictly more dangerous than Claude's bypassPermissions which still respects OS perms."

### 4.2 Session lifecycle — CORRECTED iterator usage

```ts
class CodexSession implements RuntimeSession {
  private listeners = { activity: [], exit: [], needs_restart: [] };
  private threadId: string | null = null;
  private busy = false;

  constructor(private thread: Thread, private opts: SpawnOpts) {}

  async send(text: string) {
    if (this.busy) throw new Error("session busy");
    this.busy = true;
    try {
      // runStreamed returns a Promise — must await.
      const { events } = await this.thread.runStreamed(text);
      for await (const ev of events) {
        this._mapEvent(ev);
      }
    } catch (e) {
      this._classifyError(e);   // emit { kind:"error", reason:"auth"|"rate_limit"|"network"|"budget"|"other" }
    } finally {
      this.busy = false;
    }
  }

  private _mapEvent(ev: ThreadEvent) {
    if (ev.type === "thread.started") {
      this.threadId = ev.threadId;   // CAPTURE INSIDE STREAM (Review 1 finding 8)
      return;
    }
    if (ev.type === "item.completed") {
      const it = ev.item;
      switch (it.type) {
        case "reasoning":
          return this._emit({ kind: "thinking" });
        case "agent_message":
          return this._emit({ kind: "text", text: it.text ?? "", replaces: true });
        case "command_execution":
          return this._emit({
            kind: "working", tool: "Shell",
            label: "Running command", detail: String(it.command ?? "").slice(0, 80),
          });
        case "file_change":
          // CORRECTED (Review 1 finding 7): no `path` field; iterate changes[].
          return this._emit({
            kind: "working", tool: "Edit",
            label: "Editing files",
            detail: (it.changes ?? []).map((c: any) => c.path).join(", ").slice(0, 80),
          });
        case "mcp_tool_call":          // CORRECTED (Review 1 finding 6): was `mcp_call`
          return this._emit({
            kind: "working", tool: it.server ?? "MCP",
            label: it.tool ?? "", detail: "",
          });
        case "web_search":
          return this._emit({
            kind: "working", tool: "WebSearch",
            label: it.query ?? "", detail: "",
          });
        default:
          // Unknown item subtype — log + continue. Forward-compatible
          // parser per risk #2 in §9.
          console.warn("[codex] unknown item.type:", it.type, it);
          return;
      }
    }
    if (ev.type === "turn.completed") {
      return this._emit({ kind: "turn_complete", sessionId: this.threadId ?? "" });
    }
    if (ev.type === "error") {
      return this._emit({ kind: "error", message: ev.message ?? "codex error" });
    }
  }

  private _classifyError(e: any) {
    const msg = String(e?.message ?? e);
    if (/auth|token|login|unauthor/i.test(msg)) {
      return this._emit({ kind: "error", message: msg, reason: "auth" });
    }
    if (/rate.?limit|429/i.test(msg)) {
      return this._emit({ kind: "error", message: msg, reason: "rate_limit" });
    }
    if (/network|ECONN|ETIMED|fetch failed/i.test(msg)) {
      return this._emit({ kind: "error", message: msg, reason: "network" });
    }
    if (/budget|quota|context.?window/i.test(msg)) {
      return this._emit({ kind: "error", message: msg, reason: "budget" });
    }
    this._emit({ kind: "error", message: msg, reason: "other" });
  }

  getResumeKey() { return this.threadId; }

  async shutdown() {
    // The SDK has NO Thread.end()/close() method (Review 1 finding 8).
    // CodexExec spawns codex exec per turn; nothing to clean up between turns.
    // GC + dropped reference is sufficient.
  }
}
```

### 4.3 System prompt — write `AGENTS.md` on EVERY spawn, defend against leak

Codex auto-loads `AGENTS.md` files. The walk order is: global `~/.codex/AGENTS.md` (or `AGENTS.override.md`) → project root → cwd, concatenating each. This creates two real risks:

* **Ancestor leak (Review 3 P0-1):** if the user has `~/AGENTS.md` or `~/.raltic/AGENTS.md`, Codex will merge them with our per-workDir file.
* **Stale prompt (Review 3 P0-3, P0-4):** if `restartProcess` doesn't rewrite, or the user manually deletes `AGENTS.md`, the agent runs with stale or no prompt.

**Defense:**

```ts
// In AgentManager.spawnForAgent (called on EVERY spawn — fresh, restart, edit)
const promptPath = join(workDir, "AGENTS.md");
writeFileSync(promptPath, [
  "<!-- AUTOGENERATED by raltic bridge — edits will be overwritten on next spawn -->",
  systemPrompt,
].join("\n\n"));

// Drop a sentinel empty AGENTS.md at ~/.raltic/agents/AGENTS.md ONCE at
// bridge init, so Codex's upward walk terminates there and doesn't pick
// up ~/AGENTS.md. The sentinel is intentional + idempotent.
ensureFile(join(this.agentsDir, "AGENTS.md"), "<!-- sentinel: do not edit -->");
```

* **Do NOT** use `--ignore-user-config` or `--ignore-rules` — both would nuke the user's `~/.codex/config.toml` model defaults + auth profile, breaking detect.
* **Phase 0 task (Review 3 P1-6):** empirically verify Codex re-reads `AGENTS.md` on every `startThread()`. Hypothesis: yes (the SDK spawns `codex exec` per turn, which reads files fresh). Confirm before relying on the "rewrite + respawn → next turn sees new prompt" contract.

### 4.4 Tool surface (where `raltic` CLI plugs in)

For Claude today: `--allowedTools "Bash(raltic …)"` + PATH prepend → agent calls `raltic message send` via Bash.

For Codex: shell tool is built-in; `sandboxMode: "workspace-write"` lets it run shell commands. PATH prepend works because Codex inherits our env. **Phase 0 task:** verify Codex `workspace-write` sandbox allows EXECUTING `node` outside cwd (we expect yes — sandbox restricts writes, not reads/execs). Fallback if blocked: inline the entire CLI source into the wrapper.

### 4.5 Authentication detection — env + OAuth

```ts
// detect() returns one of:
//   { binary, version, authed: true,  authMethod: "oauth" | "env" }
//   { binary, version, authed: false, authMethod: "none" }
//   { error: "..." }
```

`codex login status` only reflects OAuth (`~/.codex/auth.json`). Env-key auth must be detected separately by checking `process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY` (Review 7 finding 2). UI surfaces `authMethod` so the message is accurate ("Authenticated via env key" vs "via ChatGPT login").

**Boot timeout (Review 5 finding 5, Review 7 finding 5):**
```ts
await Promise.all([
  claudeRuntime.detect(),    // wrapped in Promise.race with 3s timeout
  codexRuntime.detect(),
]);
```
Timeout → `{error: "detect timeout"}`. Bridge boot never blocks on a broken CLI install.

### 4.6 Session-file janitor (Review 7 finding 6)

`~/.codex/sessions/` accumulates indefinitely (~1 GB observed in the wild). We do NOT silently delete unrelated user sessions, but bridge SHOULD prune sessions whose threadId matches one of OUR agents' `resumeKey` and is older than N days (default 30). Opt-in via `RALTIC_BRIDGE_PRUNE_CODEX_SESSIONS=30` env. Documented in user-facing docs but off by default.

---

## 5. Schema + protocol changes

### 5.1 D1 schema

```ts
// packages/db/src/schema.ts
export const agents = sqliteTable("agents", {
  ...,
  model: text("model").notNull().default("sonnet"),       // was enum; now free-form
  runtime: text("runtime", { enum: ["claude", "codex"] }).notNull().default("claude"),  // NEW
  ...
});
```

Migration `0005_add_agent_runtime.sql`:
```sql
ALTER TABLE `agents` ADD `runtime` text DEFAULT 'claude' NOT NULL;
-- model column type stays text; the drizzle-level enum just relaxes.
```

### 5.2 Files that change in lockstep — MUST land in one PR (Review 5 finding 2)

Loosening `model` from union to `string` breaks TypeScript across **6 files**. The migration PR (PR 2 in §12) must touch all of them or `tsc` fails:

1. `packages/db/src/schema.ts:102` — drizzle enum → text
2. `packages/protocol/src/rest.ts:34` — `bridgeConnectResponse.agents[].model` enum → `z.string().min(1).max(64)`
3. `packages/protocol/src/rest.ts:72` — `createAgentRequest.model` enum → `z.string().min(1).max(64)` + `superRefine` cross-check against runtime
4. `apps/bridge/src/agent-manager.ts:60` — `AgentSession.model: string`
5. `apps/bridge/src/agent-manager.ts:288` — `spawnProcess(..., model: string)`
6. `apps/api/src/routes/agents.ts:165` — PATCH body cast
7. `apps/web/src/lib/api.ts:78,209` — `Agent.model: string` + `updateAgent` patch type

### 5.3 Cross-validation (Review 5 finding 3)

`createAgentRequest` accepts free-form `model`. Without cross-validation, `{runtime: "claude", model: "gpt-5.5"}` silently passes the API and only fails at spawn time, minutes later, with an opaque error in the user's DM.

```ts
export const createAgentRequest = z.object({
  serverId: z.string(),
  name: z.string()...,
  displayName: z.string()...,
  description: z.string()...,
  systemPrompt: z.string()...,
  runtime: z.enum(["claude", "codex"]).default("claude"),
  model: z.string().min(1).max(64),
}).superRefine((data, ctx) => {
  const runtimeModels = runtimeRegistry[data.runtime].capabilities.models;
  if (!runtimeModels.includes(data.model)) {
    ctx.addIssue({
      code: "custom",
      path: ["model"],
      message: `Model "${data.model}" is not valid for runtime "${data.runtime}". Valid: ${runtimeModels.join(", ")}`,
    });
  }
});
```

### 5.4 `bridgeConnectResponse` extension

```ts
runtimes: z.array(z.object({
  id: z.enum(["claude", "codex"]),
  detected: z.boolean(),
  version: z.string().nullable(),
  authed: z.boolean().nullable(),
  authMethod: z.enum(["oauth", "env", "none"]).nullable(),
  error: z.string().nullable(),
}))
```

**Tighten the api → web boundary (Review 5 finding 4):** today `apps/bridge/src/bridge.ts:148` casts `res.json() as Promise<BridgeConnectResponse>` with NO zod validation. PR 4 (which adds `runtimes`) MUST also add `bridgeConnectResponse.parse(payload)` to fail-fast on protocol typos.

### 5.5 Runtime availability lives at the bridge/machine boundary, NOT per-agent (Review 6 P1-4)

v1 proposed adding `runtimeAvailability` to `GET /api/v1/agents` per-row. That's wrong shape — availability is `(machine × runtime)`, identical for all N agents.

Two complementary surfaces (v3):

**A. Per-active-bridge live state** — `GET /api/v1/me/runtimes`. Pulled from the gateway DO state, refreshed on every `/connect` + every 5 minutes while bridge is online. Used by Create-Agent dialog to grey out unavailable picker options. **Transient — not persisted to D1.**

**B. Per-machine-key history** — `GET /api/v1/me/machine-keys/runtimes`. Pulled from D1 (`machine_keys.last_detected_runtimes`). Survives offline bridges. Used by Settings → Machine API keys card and the Setup Wizard to show "what's installed where" even when the bridge isn't currently connected.

Schema:

```ts
// packages/db/src/schema.ts
export const machineKeys = sqliteTable("machine_keys", {
  ...,
  /** JSON snapshot written every time the bridge holding this key
   *  hits POST /api/v1/bridge/connect. Survives offline. */
  lastDetectedRuntimes: text("last_detected_runtimes", { mode: "json" })
    .$type<DetectedRuntimeSnapshot[]>(),
  lastDetectedAt: integer("last_detected_at", { mode: "timestamp_ms" }),
});
```

Migration `0006_machine_key_runtime_snapshot.sql`:
```sql
ALTER TABLE `machine_keys` ADD `last_detected_runtimes` text;
ALTER TABLE `machine_keys` ADD `last_detected_at` integer;
```

`DetectedRuntimeSnapshot` (protocol):
```ts
const detectedRuntimeSnapshot = z.object({
  id: z.enum(["claude", "codex"]),
  detected: z.boolean(),
  version: z.string().nullable(),
  authed: z.boolean().nullable(),
  authMethod: z.enum(["oauth", "env", "none"]).nullable(),
  error: z.string().nullable(),
});
```

Endpoint shapes:
```ts
// GET /api/v1/me/runtimes — LIVE (current bridge connection)
{
  bridge: { online: boolean; machineKeyId: string | null },
  runtimes: DetectedRuntimeSnapshot[]
}

// GET /api/v1/me/machine-keys/runtimes — HISTORICAL (all machine keys)
{
  machineKeys: Array<{
    id: string;
    name: string;
    online: boolean;        // someone's holding a live WS gateway with this key right now
    lastUsedAt: number | null;
    lastDetectedAt: number | null;
    runtimes: DetectedRuntimeSnapshot[] | null;  // null = key never connected
  }>
}
```

`/api/v1/bridge/connect` writes both:
1. Gateway DO `state.runtimes = body.runtimes` (live, transient)
2. D1 `update machineKeys set last_detected_runtimes=?, last_detected_at=? where id=?` (historical, durable)

#### Hardening (v4)

**A. Server-side validation BEFORE persisting (v4 P0 — Privacy #1).** Today `/connect` doesn't zod-parse the body; bridge could inject arbitrary structured JSON into the snapshot, which the wizard renders directly (XSS surface via `runtime.error`). Required:
```ts
const RuntimeSnapshotRequest = z.array(z.object({
  id: z.enum(["claude", "codex"]),
  detected: z.boolean(),
  version: z.string().max(64).regex(/^[\w.\-+]+$/).nullable(),
  authed: z.boolean().nullable(),
  authMethod: z.enum(["oauth", "env", "none"]).nullable(),
  error: z.string().max(512).nullable(),
})).max(8);
// ... in /connect handler:
const parsed = RuntimeSnapshotRequest.safeParse(body.runtimes ?? []);
if (!parsed.success) return c.json({error: "invalid runtimes payload"}, 400);
// persist parsed.data
```

**B. zod-parse on READ too (v4 P0 — Schema).** Older bridge versions may have written a shape that's since changed. `GET /me/machine-keys/runtimes`:
```ts
const stored = row.lastDetectedRuntimes;
const safe = RuntimeSnapshotResponse.array().safeParse(stored);
return safe.success ? safe.data : [];   // graceful fallback
```

**C. Redact in observability (v4 P0 — Privacy #2).** `bridge.ts` logs `/connect` request bodies at info level. `authMethod` reveals raw-API-key presence on a user's laptop — a security-relevant fingerprint. Log payload MUST be filtered:
```ts
const logPayload = {
  userId: subject.userId,
  serverId: subject.serverId,
  runtimes: parsed.data.map(r => ({ id: r.id, detected: r.detected /* authMethod stripped */ })),
};
```

**D. Per-(key × machineFingerprint) keying (v4 P1 — Privacy #4).** Today the snapshot is keyed by `machineKey.id`. If user uses the same key on Mac + Linux desktop (a CI-style shared-key pattern), the second bridge's `/connect` overwrites the first's snapshot — UI silently shows only the most recent. Refactor:
```ts
// `last_detected_runtimes` becomes a keyed map, not an array:
type SnapshotMap = Record<string /* machineFingerprint */, {
  runtimes: DetectedRuntimeSnapshot[];
  detectedAt: number;
  hostname?: string;       // user-friendly
}>;
```
Bridge `/connect` request adds an optional `machineFingerprint` (stable hash of hostname + first MAC address; falls back to `"default"`). Snapshot entries older than 7d are pruned at write time. `GET /me/machine-keys/runtimes` returns each machine separately.

**E. Ownership scoping (v4 P1 — Privacy #3).** `/me/machine-keys/runtimes` MUST hard-code `WHERE owner_user_id = ctx.user.id`. No `?userId=` query param. Add `policy.machineKeys.canRead(ctx, key)` helper that only returns true for owner. Tested per §10.8 item 88 — strengthen test to assert "no row from any other user is ever returned, regardless of query manipulation."

**F. Workspace member visibility (v4 — Codex external view).** Machine keys are user-private (one user, possibly many workspaces). The endpoint returns ONLY the requesting user's keys — never other workspace members' keys. Documented + tested.

**G. Atomicity + eventual consistency window (v4 P1 — Schema).** `/connect` writes DO first, then D1. On D1 failure, return 5xx so bridge retries. Document the window: if D1 succeeds but DO write fails (or vice-versa), `/me/runtimes` (DO, live) and `/me/machine-keys/runtimes` (D1, historical) can disagree for at most one connect cycle (~30s). Next `/connect` reconciles. Test 91 added.

**H. Rate limit + cache (v4 P1 — Privacy #5).** `/me/machine-keys/runtimes` is wizard-polled every 3s during setup. Without limits: 100 concurrent wizards = 33 rps sustained on a D1 read with per-key fan-out.
* Hono `rateLimiter({ window: 60s, max: 30, key: user.id })`.
* 2-second in-Worker memory cache keyed by `(userId, serverId)`. The `online` field bypasses cache (live from DO).
* Long-term: switch wizard to SSE/WS push via existing UserGateway DO.

---

## 6. Web UI changes

### 6.1 Create Agent dialog — runtime picker + bridge-aware loading states (Review 6 P0-1, P1-6)

```
┌─ Runtime ─────────────────────────────────────────────────────┐
│  [⊙ Claude]   [○ Codex]                                        │
│                                                                  │
│  (When Codex not detected:)                                     │
│  Codex isn't installed on your bridge. Run on your laptop:      │
│      npm install -g @openai/codex                                │
│      codex login                                                 │
│                                                                  │
│  (When detected but not authed:)                                │
│  Codex is installed but not signed in. Run: `codex login`        │
│                                                                  │
│  (When detected + authed via env:)                              │
│  Codex authenticated via OPENAI_API_KEY env var                  │
└──────────────────────────────────────────────────────────────────┘
```

Behavior:
* Default = first detected + authed runtime (usually Claude).
* `MODELS` list NO LONGER hardcoded in the dialog component (Review 6 P1-3). Sourced from the per-runtime `capabilities.models` from `GET /api/v1/me/runtimes`.
* Empty bridge state (Review 6 P1-6): if `bridgeConnectResponse` hasn't arrived (bridge offline / detection pending), render skeleton. If bridge connected with zero runtimes detected, block Create with "Install at least one runtime on your bridge to create agents" + link to docs.

### 6.2 Edit Agent dialog — runtime IS mutable with confirmation (Review 6 P0-2)

v1 said "runtime immutable." Reviewers correctly pointed out the bridge already respawns + rewrites system prompt on edit; switching runtime is functionally identical (rewrite prompt destination, drop resumeKey, respawn). Locking forces delete+recreate, losing DM history unnecessarily.

**Revised:** runtime IS editable, but the form shows an inline warning when changed:

> Switching runtime starts a fresh session — past context won't carry over. Your DM history is preserved.

On save, AgentManager drops the old `resumeKey`, rewrites `AGENTS.md` if new runtime is Codex (or removes if switching away), and respawns.

### 6.3 Agent profile + sidebar runtime badge (Review 6 P1-5)

A proper `<Badge runtime>` component matching the existing status-pill geometry. Cyan accent for Claude, amber for Codex. Visible in sidebar agent rows, agent profile header, and message-area sender area.

### 6.4 Model picker filters by runtime

When user changes runtime selector, the model dropdown updates from `runtimes.find(r => r.id === selectedRuntime)?.capabilities.models`. Default selection is the first model in the list (or the runtime's recommended default surfaced in `capabilities.defaultModel`).

### 6.5 Settings → Machine API keys: per-machine runtime badges (v3)

Each machine-key row in `apps/web/src/app/s/[slug]/settings/page.tsx`'s "Machine API keys" card gets a runtime-availability strip below the key fingerprint:

```
┌─ Machine API keys ─────────────────────────────────────────────┐
│  My Mac          ck_…7PKj  •  last used 2m ago      [⊙ online] │
│    ┌───────────────────┐ ┌──────────────────┐                  │
│    │ ✓ Claude  2.1.142 │ │ ✓ Codex  1.4.0   │                  │
│    │   via ChatGPT     │ │   via env key    │                  │
│    └───────────────────┘ └──────────────────┘                  │
│                                                                  │
│  Desktop Linux   ck_…9aXq  •  last used 3d ago    [○ offline]   │
│    ┌───────────────────┐ ┌──────────────────────────────────┐  │
│    │ ✓ Claude  2.1.140 │ │ ⚠ Codex not installed            │  │
│    │   via API key     │ │   `npm install -g @openai/codex` │  │
│    └───────────────────┘ └──────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**Pill states + visuals (v4 — folded to 4 unambiguous states each with a Lucide icon, NOT color-only):**

| State | Icon | Background | Text | Tooltip reveals |
|---|---|---|---|---|
| **Ready** | `CheckCircle2` cyan-600 | cyan-50 | cyan-800 | version + auth method ("via ChatGPT" or "via env key") |
| **Sign-in needed** | `AlertTriangle` amber-600 | amber-50 | amber-800 | "Run `<runtime> login` on this laptop" |
| **Not installed** | `Download` zinc-600 | zinc-100 | zinc-700 | install command for the runtime |
| **Offline · last seen Xd** | `WifiOff` zinc-500 | zinc-100 dashed border | zinc-500 italic | exact age + last-known state |

> Rationale (v4 Codex external view + UI Review P0-2): the previous 5/6-state matrix folded auth-method (OAuth vs env) into a primary visual differentiator, but both meant "Ready" with equivalent UX — the distinction is tooltip-worthy, not pill-worthy. Color-blind users (deuteranopia ~5% of male users) cannot reliably distinguish amber-100 from cyan-100 at low saturation; icons add a redundant non-color cue (WCAG 1.4.1).

**Mobile layout (v4 P0 — UI Review #1):** the Settings card sits in a `max-w-2xl` container with `p-8`; on a 375px viewport the usable card-panel width is ~311px. Two pills side-by-side would truncate the install command (the *most copy-critical* string). Required:
```tsx
className="flex flex-col sm:grid sm:grid-cols-2 gap-2"
```
On `<sm` viewports pills stack vertically; never truncate install/login commands.

**`runtimes: null` rendering (v4 — Codex external view gap):** a key that has NEVER connected (snapshot is null) renders a single full-width pill: "First-time setup — run the bridge command above". This is the same look as the existing wizard step-2 hint, just contextualised here.

Data source: `GET /api/v1/me/machine-keys/runtimes` — historical snapshot, so OFFLINE machine keys still show their last-known runtime state (greyed out + age annotation).

### 6.6 Setup Wizard step 3 — show what we detected (v3, hardened v4)

After bridge connects, `setup-wizard.tsx` step 3 already shows "bridge connected." Add a runtime strip below the success line:

```
✓ Bridge connected on My Mac
  ✓ Claude 2.1.142 ready
  ⚠ Codex installed but not signed in — run `codex login` to enable
```

**Gating (v4 P1 — UI Review #3):** the runtime strip renders ONLY after `bridgeOnline === true`. Before bridge connects, step 3 is a single-purpose surface ("did the bridge connect?") and the runtime strip would compete with that signal. Placing the strip during the WAITING state would make users think setup failed when in fact it just hadn't started.

**Polling (v4 P1 — UI Review #4):** the existing step-3 poll calls `api.listMachineKeys()` every 3s (NOT `api.me()` — earlier draft was wrong). The correct extension is to **server-side join** `runtimes` into the `listMachineKeys` response — no second poller, no doubled request count, same cadence:
```ts
// GET /api/v1/machine-keys response gains an optional `runtimes` field per row:
{ keys: [{ id, name, prefix, lastUsedAt, runtimes?: DetectedRuntimeSnapshot[] | null, ... }] }
```
The Wizard reads the just-issued key's runtimes via the same response it's already consuming. If the user runs `codex login` mid-wizard, the next 3s tick picks it up.

### 6.7 Visibility everywhere a runtime decision is made (v4 trimmed)

| Surface | What it shows | Source |
|---|---|---|
| Create Agent dialog runtime picker | Live availability + install hint inline | `/api/v1/me/runtimes` (live) |
| Edit Agent dialog runtime picker | Live availability + cross-runtime model list | same |
| Sidebar agent rows | Runtime badge (Claude=cyan, Codex=amber) | `agent.runtime` from D1 |
| Agent profile header | Runtime badge + model badge | same |
| Settings → Machine API keys card | Per-machine runtime + version + auth method | `GET /api/v1/machine-keys` (server-joined) |
| Setup Wizard step 3 (after bridgeOnline) | Detected runtimes on the just-connected laptop | same |

The earlier draft listed an "Onboarding empty state" row pointing to the same data source. Dropped (v4 P1 UI Review #5): when the user has no bridge they have no machine, so the snapshot is irrelevant — that surface only needs static install docs from wizard step 1/2 and shouldn't share plumbing with the historical-snapshot views.

**Multi-user / multi-workspace visibility (v4 Codex external view):** machine keys are user-private (one user, possibly many workspaces). `/api/v1/me/machine-keys/runtimes` returns ONLY the requesting user's own keys — never other workspace members' keys, even within the same shared workspace. Tested per §10.8 item 88.

---

## 7. System prompt handling

`apps/bridge/src/system-prompt.ts` returns markdown. Same content for both runtimes — Review 3 P1-5 verified there's no Claude-specific tool-naming that misleads Codex. The prompt's heredoc examples (`<<'EOF'`) assume bash; Codex's `shell` tool on macOS/Linux is bash, so OK. (Windows is not a supported bridge target.)

* Claude: passed via `--append-system-prompt`.
* Codex: written to `<workDir>/AGENTS.md` on every spawn (§4.3).

If a per-runtime addendum is needed later (e.g. Codex sandbox semantics), `buildSystemPrompt` takes a `runtime` parameter and appends a small section conditionally.

---

## 8. Authentication UX (consolidated)

* **Boot detection** — `Promise.all([claudeDetect, codexDetect])` each wrapped in `Promise.race` with 3s timeout.
* **Auth state surfaced** via `runtimes[i].authed + authMethod` in `/connect` and `/api/v1/me/runtimes`.
* **Multi-bridge runtime divergence** (Review 7 finding 4): if a user has bridges on multiple machines, `GET /api/v1/me/runtimes` returns the union with per-bridge availability:
  ```json
  {
    "runtimes": [
      {"id":"claude","availableOn":["macbook-pro","desktop-linux"]},
      {"id":"codex","availableOn":["macbook-pro"],"unavailableOn":["desktop-linux"]}
    ]
  }
  ```
  UI surfaces this in the picker tooltip. Agent runtime selection is workspace-wide; if a user message arrives on a bridge that doesn't support the agent's runtime, the bridge logs a `bridge_capability_missing` error event and the message is queued/dropped (no silent failure).
* **BYOK** explicit non-goal for v1. Schema supports adding `user_runtime_credentials` table in v2 without migration of existing rows (Review 7 finding 3). Add a code comment to `agents` table forbidding direct credential storage.

---

## 9. Risks (rev'd from v1)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Codex SDK changes event types between versions | High | Pin specific version in `package.json` (no `^`). CI snapshot test against fixtures in `tests/fixtures/codex-events.ndjson`. Document version compatibility window. |
| 2 | `runStreamed()` yields events with shapes not seen during Phase 0 capture | High | Parser logs unknown events to console + continues. Never crashes. Forward-compatible. |
| 3 | Codex `workspace-write` sandbox blocks `node` execution outside workDir | Medium | **Phase 0 verification task.** If blocked, copy CLI bin into workDir. |
| 4 | Codex `approvalPolicy: never` denies a tool call the user wanted; agent reports failure without surfacing to user clearly | Medium | Activity event `{kind:"working"}` includes `denied:true` flag when applicable; UI shows "agent tried to X but was blocked by sandbox" hint. |
| 5 | OAuth-only login fails on headless Linux servers | Medium | UX: surface `CODEX_API_KEY` env path as documented alternative; bridge readme covers both. |
| 6 | Rate limits differ between Anthropic + OpenAI; agents fail at different points | Low | Error events carry `reason: "rate_limit"` + provider-attributed message. |
| 7 | AGENTS.md ancestor leak | **Resolved by §4.3 sentinel** | Sentinel at `~/.raltic/agents/AGENTS.md` terminates Codex's upward walk. |
| 8 | Codex per-turn `codex exec` spawn overhead | Low | Comparable to Claude's per-message stdin write within a long-lived process. Measure in test §10.5. |
| 9 | `~/.codex/sessions/` growth (verified 1 GB in wild) | Medium | Opt-in janitor §4.6. |
| 10 | `codex` binary on PATH conflicts with unrelated tool | Very low | `detect()` validates `--version` output shape; refuses unknown binaries. |
| 11 | Bridge boot blocks on broken CLI install | **Resolved by §4.5 timeout** | 3s Promise.race timeout, treat as `{error:"detect timeout"}`. |
| 12 | Concurrent Claude + Codex agents in same channel race on broadcast | Low | Test scenario added (§10.7 item 73); per-agent ordering preserved by the AgentManager queue. |
| 13 | Resume-key drift (codex session file manually deleted) | Low | Adapter retries `startThread()` on `resumeThread()` error; clears stale key; next `turn_complete` writes fresh id. |
| 14 | User manually edits `<workDir>/AGENTS.md` | Low | Documented as "AUTOGENERATED, will be overwritten." Tested per §10.7 item 75. |
| 15 | Permission mode change mid-conversation | Medium | Spec: applies on next user message via session respawn. Tested per §10.7 item 76. |

---

## 10. Test plan (rev'd — 76 cases)

### 10.1 Unit — `packages/agent-runtime`

**ClaudeRuntime parser** (NDJSON fixtures):
1. `system.init` event → captures sessionId
2. `assistant{thinking}` → `ActivityEvent{kind:"thinking"}`
3. `assistant{text}` → `ActivityEvent{kind:"text", replaces:true}`
4. `assistant{tool_use Bash}` → `working{tool:"Bash", detail:cmd}`
5. `assistant{tool_use WebSearch}` → `working{tool:"WebSearch"}`
6. `result` → `turn_complete{sessionId}`
7. Malformed JSON line → ignored, no crash
8. Unknown event type → logged + ignored
9. Empty buffer → no events
10. Multiple events split across chunk boundaries → split correctly
11. `system.compacting` → emits `needs_restart{reason:"compacting"}`

**CodexRuntime parser** (mock event iterator):
12. `thread.started{threadId}` → captures threadId
13. `item.completed{type:"reasoning"}` → `thinking`
14. `item.completed{type:"agent_message"}` → `text`
15. `item.completed{type:"command_execution", command:"ls -la"}` → `working, tool:"Shell"`
16. `item.completed{type:"file_change", changes:[{path:"a.ts"},{path:"b.ts"}]}` → `working, detail:"a.ts, b.ts"`
17. `item.completed{type:"mcp_tool_call", server:"foo", tool:"do_x"}` → `working, tool:"foo", label:"do_x"`
18. `item.completed{type:"web_search", query:"react"}` → `working, tool:"WebSearch"`
19. `turn.completed` → `turn_complete{sessionId: threadId}`
20. `error` event → `error{message}`
21. Unknown item.type → logged + ignored
22. Error thrown mid-stream classified as `{reason:"auth"|"rate_limit"|"network"|"budget"|"other"}` (5 sub-cases)

**Permission mapping (CodexRuntime)**:
27. `readOnly` → sandbox=`read-only`, approval=`never`
28. `default` → sandbox=`read-only`, approval=`never`
29. `acceptEdits` → sandbox=`workspace-write`, approval=`never`
30. `bypassPermissions` → sandbox=`danger-full-access`, approval=`never`
31. Unknown mode → defaults to `workspace-write` + `never`

**Detect logic**:
32. `claude` not on PATH → `{error}`
33. `claude` exists + version → `{binary, version, authed:true}` (claude OAuth check)
34. `claude --version` hangs > 3s → `{error:"detect timeout"}`
35. `codex` not on PATH → `{error}`
36. `codex` OAuth authed → `{binary, version, authed:true, authMethod:"oauth"}`
37. `codex` no OAuth + `CODEX_API_KEY` set → `{authed:true, authMethod:"env"}`
38. `codex` no OAuth + no env → `{authed:false, authMethod:"none"}`
39. `codex login status` hangs > 3s → `{error:"detect timeout"}`

### 10.2 Integration — `apps/bridge`

40. AgentManager dispatches by `agent.runtime` field correctly
41. Unknown runtime → error logged + agent skipped (no crash)
42. Claude session 3 messages back-to-back → 3 `turn_complete` events in order
43. Codex session 3 messages back-to-back → 3 `turn_complete` events in order
44. Send while busy → queue drains in order on next `turn_complete`
45. Send after `session.shutdown()` → respawn auto-fires
46. Claude `--resume <id>` after bridge restart → context preserved
47. Codex `resumeThread(id)` after bridge restart → context preserved
48. Resume key invalid → fallback fresh session
49. Codex agent → `<workDir>/AGENTS.md` exists with rendered prompt after spawn
50. System prompt edited → respawn → next message reflects new prompt
51. Claude agent: no AGENTS.md written (sanity)
52. ClaudeRuntime emits → POST `/agent-activity` fires
53. CodexRuntime emits → POST `/agent-activity` fires (same shape)
54. Bridge offline mid-turn → graceful event drain
55. Bridge boot `runtimes` array in `/connect`
56. Both runtimes detected → 2 array items
57. Only one runtime detected → other shows `detected:false`
58. Bridge restart re-detects (no cached stale state)
59. Sentinel `~/.raltic/agents/AGENTS.md` exists after bridge init

### 10.3 E2E — manual checklist (Playwright deferred; Review 9 finding 4)

60. Create-agent dialog defaults to Claude when fresh
61. Pick Codex (not installed) → install hint visible
62. Pick Codex (installed, not authed) → login hint visible
63. Pick Codex (env-authed) → "authenticated via env" hint
64. Save Codex agent + gpt-5.4 → sidebar badge "Codex · gpt-5.4"
65. Send message to Codex agent → reply with AI badge + cyan rule
66. Edit Codex agent → change runtime to Claude → confirmation warning shown; on save, fresh session, DM history preserved
67. Delete Codex agent → DM removed, no orphan AGENTS.md
68. 3-turn Codex conversation preserves context
69. 3-turn Claude conversation preserves context (regression)
70. Two agents (one each runtime) in same channel respond independently to `@mention`s

### 10.4 Snapshot tests

71. Real Codex `runStreamed()` 3-turn dump → `tests/fixtures/codex-events.ndjson` → parser pinned
72. Real Claude NDJSON 3-turn dump → `tests/fixtures/claude-events.ndjson` → parser pinned

### 10.5 Performance smoke

73. Per-message wall time Claude vs Codex (same prompt) — acceptable spread ±30%
74. Bridge RSS after 5 agents online (mixed runtimes) — acceptable <500MB on Mac

### 10.6 Security checks

75. Codex `bypassPermissions` → confirm shell commands outside workDir SUCCEED (intended)
76. Codex `acceptEdits` → confirm shell commands writing outside workDir FAIL as sandbox-denied tool errors (NOT hang)
77. Codex `readOnly` → confirm writes inside workDir FAIL as tool errors
78. Message containing `; rm -rf ~/.raltic` to Codex agent (acceptEdits) → no damage (model behavior test, sandbox is backstop)

### 10.7 Added per Review 8 (8 missing scenarios)

79. Concurrent cross-runtime broadcast race: one Claude + one Codex emit `ActivityEvent` within same event-loop tick → both POSTs arrive with correct `agentId`, ordering preserved per-agent, no payload bleed
80. Mid-stream Codex SDK failure: `runStreamed()` throws after `item.started` before `turn.completed` (rate-limit / OAuth expired / network drop) → AgentManager emits `error{reason}` + `turn_complete`, preserves threadId, surfaces auth-expired distinctly
81. Resume-key drift: persisted threadId points to deleted `~/.codex/sessions/<id>.jsonl` → `resumeThread()` fails fast → AgentManager clears stale key → next `turn_complete` writes new id
82. AGENTS.md user tampering: user hand-edits `<workDir>/AGENTS.md` between turns → next spawn silently overwrites (pinned policy + header comment makes this explicit)
83. Permission mode change mid-conversation: edit `acceptEdits` → `bypassPermissions` while agent mid-turn → applies on next user message via respawn (NOT immediate)
84. Duplicate-machine-key threadId collision: two bridges share a machine key, both try to `resumeThread()` same threadId concurrently → second errors out (cannot fork); guard test asserts detection
85. Token-budget exhaustion: `turn.completed.usage` exceeds quota → SDK emits error variant → parser maps to `error{reason:"budget"}` + `turn_complete`, not silently swallowed
86. Incremental `agent_message` streaming: Codex emits multiple `agent_message` items per turn → parser policy = each `item.completed{agent_message}` emits a separate `text` ActivityEvent with `replaces:true` (UI replaces last frame). Pinned.

### 10.8 Per-machine runtime visibility (v3 additions, hardened v4)

87. Bridge `/connect` writes `machineKeys.last_detected_runtimes` + `last_detected_at` in D1; verifiable via `wrangler d1 execute` on the row.
88. `GET /api/v1/me/machine-keys/runtimes` ownership scoping:
    a. returns only the requesting user's keys — never another user's;
    b. ignores `?userId=` / path manipulation attempts;
    c. workspace co-members cannot read each other's keys even in shared workspaces.
89. Settings card renders correct pill + icon for each of the **4 states** (v4 §6.5: Ready / Sign-in needed / Not installed / Offline) — Storybook-style snapshot per state. Verify Lucide icons present, not just color.
90. Setup Wizard step 3 — runtime strip renders ONLY when `bridgeOnline === true`; before bridge connects the strip is hidden. When user runs `codex login` mid-wizard, the next 3s `listMachineKeys` poll picks up the new authed state.
91. `/connect` D1/DO atomicity: when D1 write throws after DO write succeeds, bridge sees 5xx + retries; next `/connect` reconciles. `/me/runtimes` and `/me/machine-keys/runtimes` agree within one connect cycle (~30s).
92. **XSS injection defense (v4 P0 — Privacy #1):** bridge POSTs `/connect` with `runtimes: [{id:"claude", error:"<script>alert(1)</script>…"}]` — server zod-parses, rejects oversize or pattern-mismatched fields; nothing reaches D1, nothing reaches UI. Also: re-run with a valid but bogus shape (older bridge version) — read-side `safeParse` returns `[]` (graceful), no crash.
93. **Log redaction (v4 P0 — Privacy #2):** trigger `wrangler tail` during a `/connect`; assert the logged payload contains `runtimes[].id` + `detected` only, NEVER `authMethod` / `version` / `error` strings.
94. **Shared machine key + multiple bridges (v4 P1 — Privacy #4):** user starts bridge on Mac (with `machineFingerprint:"mac-abc"`) and Linux (`linux-xyz`) sharing one key. Both connect concurrently. `/me/machine-keys/runtimes` returns both machines under one key, each with its own runtimes; UI shows two separate machine entries. Neither machine's snapshot is silently dropped.
95. **Mobile pill layout (v4 P0 — UI #1):** at 375px viewport, Settings card pills stack vertically (`flex flex-col sm:grid sm:grid-cols-2`). Install/login command strings are never truncated.
96. **Color-blind safety (v4 P0 — UI #2):** simulate deuteranopia (Chrome DevTools rendering); each of the 4 states is distinguishable by icon shape alone with color stripped.
97. **Endpoint rate limit + cache (v4 P1 — Privacy #5):** hammer `/me/machine-keys/runtimes` from a single user > 30 reqs in 60s → 429 with retry-after; cache hits (within 2s) skip D1 read but `online` field still reflects current DO state.

---

## 11. Phased delivery (revised per Review 9)

### Phase 0 — Reconnaissance (1 day)
* Capture 3-turn `runStreamed()` event dump from real Codex session → commit as `tests/fixtures/codex-events.ndjson`.
* Verify Codex `workspace-write` sandbox allows `node /Users/.../raltic` execution.
* Verify `codex login status` exit code semantics for both OAuth and env-key paths.
* Verify `startThread()` re-reads AGENTS.md fresh on each call.
* **Deliverable**: a written `docs/SDK_REALITY_NOTES.md` capturing every place the SDK behaved differently from the public docs. This is the de-risking artifact for Phase 3.

### Phase 1 — Extract `AgentRuntime` interface + ClaudeRuntime (1–2 days)
* New package `packages/agent-runtime/`.
* Move bridge code into `ClaudeRuntime`.
* AgentManager consumes via registry. Default `agent.runtime = "claude"` is implicit (PR 1 doesn't read the new column).
* **Unit tests for parser + permission mapping bundled in PR 1 (Review 9 finding 5).** Splitting tests to a later PR breaks bisect.
* CI: add `madge --circular` check for cyclic imports.
* No behavior change; existing smoke passes.

### Phase 2 — Schema + protocol + minimal UI plumbing (½ day)
* D1 migration `0005_add_agent_runtime.sql`.
* Loosen `model` to text across all 6 files in §5.2 in one diff.
* Bridge `/connect` returns `runtimes` array; api parses with zod.
* Picker SHOWS in UI but Codex option is **disabled** (greyed) until Phase 3 lands.

### Phase 3 — CodexRuntime adapter (3 days; Review 9 finding 3)
* Implement `packages/agent-runtime/src/codex.ts` per §4.
* AGENTS.md writer + sentinel in AgentManager.
* Session-file janitor (opt-in).
* All §10.1 items 12–22, 27–31, 35–39 pass.
* Manual: create Codex agent, DM, reply. Behind feature flag `RALTIC_BRIDGE_ENABLE_CODEX=1`.

### Phase 4 — Documentation (½ day; reordered ahead of enable)
* `docs/RUNTIMES.md` user-facing: install instructions for each runtime, auth setup, model lists, permission mode semantics.
* Updated CLAUDE.md mentioning runtime picker.
* Lands BEFORE Phase 5 so picker users have a target to read.

### Phase 5 — Enable Codex + hardening (2 days)
* Drop feature flag; enable Codex option in picker.
* Integration tests §10.2.
* E2E manual checklist §10.3.
* Performance smoke §10.5.
* Security checks §10.6.
* Added scenarios §10.7.

**Total: 8–11 engineering days.**

---

## 12. PR breakdown (revised per Review 9 finding 6)

| PR | Title | Scope | Risk |
|---|---|---|---|
| 1 | `packages/agent-runtime`: extract `AgentRuntime` interface + `ClaudeRuntime` **+ unit tests** | Move code, bundle parser/permission tests. Behavior identical. CI adds `madge --circular`. | Low |
| 2 | DB migration + protocol loosening | All 6 files in §5.2 in ONE diff. Migrations `0005_add_agent_runtime.sql` + `0006_machine_key_runtime_snapshot.sql`. | Low |
| 3 | Bridge `/connect` returns `runtimes` array + zod parsing + writes `machineKeys.last_detected_runtimes` (v3) | Bridge detect logic (timeout-wrapped). API parses + persists snapshot. | Low |
| 4 | UI: runtime picker (Claude only, Codex disabled) + Edit dialog runtime field (locked until 5b) | No new runtime live yet. | Low |
| 5a | `CodexRuntime` adapter behind feature flag | Adapter + AGENTS.md writer + sentinel + session-file janitor. Pinned `@openai/codex-sdk` version. No UI exposure. | High |
| 6 | **Docs PR — `docs/RUNTIMES.md` + CLAUDE.md updates** | User-facing install + setup + model + permission docs. | Low |
| 5b | Enable Codex in picker + Edit dialog runtime-switching UX + Settings runtime badges + Wizard runtime strip (v3) | Drop feature flag. Confirmation warning on runtime change. Activity badge per runtime. New endpoint `GET /api/v1/me/machine-keys/runtimes`. §6.5–6.7 UI surfaces. | Medium |
| 7 | Tests + fixtures consolidation + E2E manual checklist | §10.7 scenarios, snapshot fixtures, security checks. | Low |

**Land order:** 1 → 2 → 3 → 4 → 5a → 6 → 5b → 7. Docs land BEFORE enable.

---

## 13. Open questions resolved by v2

* ~~Pin Codex SDK to which version?~~ — Phase 0 task: confirm latest stable + pin exact version (no caret).
* ~~AGENTS.md placement / ignore-user-config~~ — sentinel approach in §4.3, never use `--ignore-*` flags.
* ~~Thread.id stability~~ — captured inside stream from `thread.started` event (§4.2).
* ~~Default to Codex if Claude not installed~~ — default to first detected+authed runtime.
* ~~Backwards compat for existing model values~~ — confirmed: "sonnet"/"opus"/"haiku" pass `z.string().min(1).max(64)`.

---

## 14. Review checklist (before merge of any PR)

* [ ] All §10 unit tests pass (CI).
* [ ] All §10 integration tests pass (CI).
* [ ] Manual smoke: create Codex agent, send message, get reply.
* [ ] Manual smoke: create Claude agent (regression), send message, get reply.
* [ ] Manual smoke: edit Codex agent's system prompt → next message reflects new behavior.
* [ ] Manual smoke: edit Claude agent's system prompt → same.
* [ ] Manual smoke: switch agent runtime Claude→Codex → fresh session, DM history preserved.
* [ ] Bridge boot prints both runtimes' detection state (3s timeout).
* [ ] UI runtime picker correctly disables non-detected options with install hints.
* [ ] Security: `acceptEdits` Codex agent CANNOT write outside workDir (§10.6 item 76).
* [ ] Security: `readOnly` Codex agent CANNOT write inside workDir (§10.6 item 77).
* [ ] Sentinel `~/.raltic/agents/AGENTS.md` exists post-init.
* [ ] No new lint / type errors.
* [ ] Cyclic import check (`madge --circular`) clean.

---

## Appendix A — SDK API verification corrections (Review 1)

These corrections to v1 were verified against `openai/codex` repo at `sdk/typescript/src/{codex,thread,items,events,codexOptions,threadOptions}.ts`:

| v1 wrote | Verified actual |
|---|---|
| `new Codex({config: {model, sandbox, approval_policy}})` | Codex constructor takes `{codexPathOverride, baseUrl, apiKey, config (generic TOML bag), env}` ONLY. Model/sandbox/approval go on `ThreadOptions`. |
| `sandbox: "..."` / `approval_policy: "..."` | `sandboxMode: "..."` / `approvalPolicy: "..."` — camelCase. |
| `const stream = thread.runStreamed(...); for await (const e of stream)` | `const { events } = await thread.runStreamed(...); for await (const e of events)` — runStreamed returns Promise<StreamedTurn>. |
| `codex.resumeThread(threadId)` (no options) | `codex.resumeThread(threadId, threadOptions?)` — must thread options through on resume too. |
| `item.completed{type:"mcp_call"}` | `item.completed{type:"mcp_tool_call"}` with `server` + `tool` fields. |
| `item.completed{type:"file_change", path:"…"}` | `item.completed{type:"file_change", changes: FileUpdateChange[]}` where each has `path` + `kind:"add"\|"delete"\|"update"`. |
| `thread.id` after stream loop | NULL until `thread.started` event arrives mid-stream; capture inside `_mapEvent`. |
| `Thread.end()` cleanup | Does not exist. SDK spawns `codex exec` per turn (NOT `codex mcp-server`); nothing to close between turns. v1's "long-lived child process" framing was wrong; the user-facing API IS persistent (Thread object), but the underlying process is per-turn. |

---

## Sources

* [Codex CLI reference — developers.openai.com](https://developers.openai.com/codex/cli/reference)
* [Codex CLI non-interactive mode](https://developers.openai.com/codex/noninteractive)
* [Codex CLI features](https://developers.openai.com/codex/cli/features)
* [Codex SDK overview](https://developers.openai.com/codex/sdk)
* [Codex + Agents SDK (MCP server mode)](https://developers.openai.com/codex/guides/agents-sdk)
* [AGENTS.md convention](https://developers.openai.com/codex/guides/agents-md)
* [@openai/codex-sdk on npm](https://www.npmjs.com/package/@openai/codex-sdk)
* [openai/codex GitHub repo](https://github.com/openai/codex) — SDK source at `sdk/typescript/src/`

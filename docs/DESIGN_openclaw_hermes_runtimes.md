# Integrating OpenClaw + Hermes as agent runtimes

Status: **BUILT — shipped under tasks S1–S10 + two rounds of codex-review fixes (4-module round + final 10C+10X agent-team round). Smoke test runbook at `docs/SMOKE_TESTS_openclaw_hermes.md` still required before exposing real user traffic.**

> Second-round fix summary (final agent-team review):
> - **bridge.ts**: legacy gemini/copilot runtime coerced to "claude" so one stale agent can't 500 the entire `/bridge/connect`
> - **RuntimeChip + RuntimeDot + EditAgentDialog**: graceful fallback for unknown runtime values (banner instead of white-screen)
> - **openclaw + hermes turn_complete**: always emit `sessionId: ev.threadId ?? ""` — never swallow, AgentManager would deadlock
> - **openclaw + hermes exit listener**: only fire on aborted/fatal (code !== 0) — per-turn CLI exit is normal lifecycle, not session death
> - **listener dispatch**: snapshot + per-cb try/catch so one throwing listener doesn't blast the rest
> - **classifyError**: tightened bounds (\b, specific tokens) + added not_installed/spawn_failed buckets; lock-step between openclaw + hermes
> - **settings-shared**: "needs_login" copy branched per runtime — external_daemon runtimes say "start daemon" not "{id} login"
> - **wizard step-1 hermes hint**: now mentions `hermes start`, not just `hermes status`
> - **RUNTIME_MODELS.hermes**: ["auto", "router-default"] so edit dialog doesn't render a single-token stub
> - **wizard step-1 copy**: "Both run locally" → "All run locally" (4 options, not 2)

> History note: v1/v2 of this doc retained gemini + copilot scaffolds
> from a prior aborted exploration. The user opted to remove both
> during build, so the final `RuntimeId` union is
> `"claude" | "codex" | "openclaw" | "hermes"`. Sketches below that
> still mention `gemini` / `copilot` are preserved as historical
> context — not the shipped surface.

Author: deep-research pass on Raltic's runtime abstraction, OpenClaw README, Hermes Agent landing page + Nous Research docs.
Last updated: 2026-05-23.

---

## 0. TL;DR

Raltic's bridge already abstracts agent runtimes behind a clean
`AgentRuntime` interface (`detect()` + `spawn()`). Adding OpenClaw and
Hermes as additional `RuntimeId` variants is a **mechanical extension**
of that interface — no architectural changes required for the happy
path. The interesting design work is in handling their lifecycle
differences (both are persistent daemons rather than per-turn spawns
like Claude Code), their unique stream formats, and their auth
models. This document specifies the integration in full so a build
phase can ship without ambiguity.

**Effort estimate (revised after codex review)**: 5–7 days for v1
(both runtimes), because the enum lives in 23+ places — schema +
protocol + API + 4 web components + bridge + types — and each needs
synchronous update or runtime breaks. Plus 1 day for the agent-team
review pass. Original "mechanical extension" framing held for the
runtime CLASS files; the rest of the codebase coupling was
underestimated.

---

## 1. What OpenClaw and Hermes actually are

### OpenClaw

- Author: Peter Steinberger.
- Package: `npm i -g openclaw` (~84 MB unpacked, current 2026.5.20).
- Self-described: "a personal AI assistant you run on your own
  devices." Local-first messaging gateway with embedded agent.
- CLI surface (from upstream README + npm bin entry):
  - `openclaw onboard --install-daemon` — first-time setup (writes
    a launchd / systemd unit).
  - `openclaw gateway --port 18789 --verbose` — runs the daemon in
    the foreground (the daemon also auto-starts via launchd).
  - `openclaw gateway status` — daemon liveness probe.
  - `openclaw agent --message "..." --thinking high` — fire a one-
    shot agent turn. **This is the interesting one for us.**
  - `openclaw message send --target +123… --message "…"` — send
    via channel (Telegram, iMessage, etc.).
  - `openclaw pairing approve <channel> <code>` — multi-channel
    pairing.
  - `openclaw doctor` — diagnostics.
- Runtime shape: persistent daemon (gateway) + per-call CLI. The
  daemon hosts the model session, memory, multi-channel routing. The
  CLI is a thin client over a local RPC port. **One process per
  user, not per agent turn.**
- Multi-agent routing: README mentions "route inbound
  channels/accounts/peers to isolated agents (workspaces + per-agent
  sessions)" — so the daemon already supports multiple agents.
- Auth: API key for the model provider (OpenAI / Anthropic etc.)
  configured at onboard time. No bridge-side auth needed beyond
  trusting localhost RPC.

### Hermes Agent

- Author: Nous Research (released Feb 2026; #1 on OpenRouter
  May 2026 with 224B tokens/day).
- Package: single-command curl install (Linux/macOS/WSL2). The
  installer drops a binary + sets up a Unix-socket RPC.
- Self-described: "the agent that grows with you — learns your
  projects, builds its own skills, and reaches you wherever you
  are."
- Runtime shape: persistent daemon + Unix-socket RPC. Sandboxed
  code execution. Auto skill creation. Persistent memory.
  Supports 300+ models across providers.
- CLI: similar persistent-process model to OpenClaw (per Composio's
  comparison docs). Multi-platform reach (Telegram/Slack/Discord/
  WhatsApp), so it's natively a multi-channel agent — Raltic
  becomes one more channel.
- Auth: model API key + optional skill-marketplace token.

### Why they're different from Claude Code + Codex

| Property | Claude Code | Codex | OpenClaw | Hermes |
|---|---|---|---|---|
| Process model | per-turn spawn | per-turn spawn (`codex exec`) | persistent daemon | persistent daemon |
| State | stateless between turns (resumable via sessionId) | resumable via threadId | daemon owns memory | daemon owns memory + skills |
| Stream format | NDJSON over stdout | SDK-provided AsyncGenerator | local HTTP / RPC (TBD) | Unix-socket RPC |
| Activation | child_process | `@openai/codex-sdk` | exec `openclaw agent` OR direct HTTP to gateway | exec `hermes` OR socket RPC |
| Auth | OAuth at install | API key | Provider key in daemon config | Provider key in daemon config |

The key consequence: **Claude/Codex are pull-based** (Raltic spawns
on demand). **OpenClaw/Hermes are push-based** (the daemon runs
forever; Raltic either CLI-shells per turn or opens a long-lived
RPC client). Both modes are reasonable; we choose CLI-per-turn for
the v1 because it composes cleanly with the existing
`spawn()`-then-`emit-activity` flow.

---

## 2. Raltic's existing runtime abstraction

The relevant interface lives at `packages/agent-runtime/src/types.ts`:

```ts
export type RuntimeId = "claude" | "codex" | "gemini" | "copilot";

export interface AgentRuntime {
  readonly id: RuntimeId;
  readonly displayName: string;
  readonly capabilities: RuntimeCapabilities;
  detect(): Promise<DetectResult>;
  spawn(opts: SpawnOpts): RuntimeSession;
}

export interface RuntimeSession {
  send(turn: ChatTurn): Promise<void>;       // user message → agent
  on(event: "activity", cb: ActivityListener): () => void;
  on(event: "exit", cb: ExitListener): () => void;
  getResumeKey(): string | null;
  shutdown(): Promise<void>;
}
```

Existing implementations:
- `packages/agent-runtime/src/claude.ts` — `child_process.spawn("claude", […])`, parses NDJSON.
- `packages/agent-runtime/src/codex.ts` — wraps `@openai/codex-sdk` Thread API.
- `packages/agent-runtime/src/gemini.ts`, `copilot.ts` — stubs marked
  "not yet shipped".

Registry at `packages/agent-runtime/src/index.ts`:
```ts
export function buildRuntimeRegistry(): Record<RuntimeId, AgentRuntime> {
  return { claude: new ClaudeRuntime(), codex: new CodexRuntime(), ... };
}
```

Bridge consumer at `apps/bridge/src/index.ts` calls
`buildRuntimeRegistry()` and forwards messages by `agent.runtimeMode`
→ matching `AgentRuntime.spawn()`.

**Adding a runtime requires** (codex review v2 — 17 sites total):

| # | File | What |
|---|---|---|
| 1 | `packages/agent-runtime/src/types.ts:19` | extend `RuntimeId` union |
| 2 | `packages/agent-runtime/src/{openclaw,hermes}.ts` | new runtime classes |
| 3 | `packages/agent-runtime/src/index.ts` | registry + exports |
| 4 | `packages/bridge-core/src/agent-manager.ts:658` | detect-at-boot id list |
| 5 | `packages/bridge-core/src/bridge.ts` | snapshot wire format if it iterates ids |
| 6 | `packages/db/src/schema.ts:135` | drop enum OR extend it + migration |
| 7 | `packages/protocol/src/rest.ts` (5 sites) | extend zod enums |
| 8 | `apps/api/src/routes/agents.ts:20, 30` | extend route enum + AgentRuntimeMode type |
| 9 | `apps/web/src/lib/api.ts:233+` | RuntimeId + RUNTIME_LABEL + RUNTIME_MODELS |
| 10 | `apps/web/src/components/create-agent-dialog.tsx:87` | picker option + detected-runtime gate |
| 11 | `apps/web/src/components/edit-agent-dialog.tsx` | edit picker matches create |
| 12 | `apps/web/src/components/settings-shared.tsx:56` | settings runtime-status row |
| 13 | `apps/web/src/components/setup-wizard.tsx` | step-1 runtime option |
| 14 | `apps/web/src/components/sidebar.tsx` | if sidebar surfaces runtime label anywhere |
| 15 | `apps/web/src/app/s/[slug]/agents/page.tsx` | agent list display |
| 16 | `packages/db/migrations/00XX_extend_runtime_enum.sql` | schema migration |
| 17 | Smoke-test detect + a single turn locally |

**Codex review correction**: `agents.runtime` is NOT free-text. It's
a Drizzle `text(..., { enum: ["claude", "codex", "gemini", "copilot"] })`
at `packages/db/src/schema.ts:135`. The same enum is repeated at:
- `packages/protocol/src/rest.ts:28, 43, 73, 108, 124` (5 sites)
- `apps/api/src/routes/agents.ts:20, 30` (route validation + type)
- `apps/web/src/lib/api.ts:233` (RuntimeId type alias)

A **schema migration is required** — D1 doesn't enforce CHECK on
text-enum constraints unless we write them explicitly, but the
Drizzle migration generator will emit a recreate-table step to
update the enum metadata. Two approaches:
1. Add a CHECK constraint via raw migration that lists all 6 names.
2. Drop the enum and rely on app-layer validation (current zod
   schemas cover this); switch to plain `text("runtime")` in Drizzle.

Approach #2 is cheaper (no rebuild table) and consistent with how
`agents.runtime_mode` is enforced (bridge|raltic, app-layer only).
Build phase chooses based on what `drizzle-kit generate` produces.

---

## 3. Three integration paths (with tradeoffs)

### Option A — Wrap each as a bridge-side runtime (RECOMMENDED)

Add `OpenClawRuntime` and `HermesRuntime` next to Claude/Codex in
`packages/agent-runtime/`. Bridge calls them the same way it calls
Claude. Daemon discovery + CLI shell-out happens inside the runtime
class.

- ✅ Symmetric with the existing pattern — zero net new abstractions.
- ✅ User-facing: just another option in the agent creation dialog.
- ✅ No web/API changes beyond the runtime picker.
- ⚠️ Each turn shells out a CLI; the daemon's own session memory
  belongs to OpenClaw/Hermes, not Raltic. So Raltic's
  `getResumeKey()` returns whatever the daemon hands us (or `null`
  with a documented "daemon owns the session" caveat).
- ⚠️ The user must have onboarded OpenClaw/Hermes themselves first
  (provider API key in the daemon). Bridge `detect()` checks for
  the daemon's reachability, not for auth.

### Option B — Generic "external HTTP agent" registration

Raltic exposes an HTTP endpoint that any tool (OpenClaw, Hermes,
n8n, a custom script) can POST to. Each external agent registers
once and gets a token; subsequent messages flow over HTTP.

- ✅ Future-proof — covers tools we haven't thought of.
- ✅ Lets a user run OpenClaw on a DIFFERENT machine than the
  bridge.
- ❌ Big new auth + protocol surface to design + secure (think pair-
  agent skill in gstack — that took months of iteration).
- ❌ Doesn't solve the "I clicked 'create agent' and picked
  OpenClaw" UX flow.
- ❌ Reinvents the wheel — OpenClaw/Hermes both already speak
  their own protocols; we'd be adding a third.

### Option C — ACP-compatible (reverse direction)

OpenClaw uses ACP (Agent Coordination Protocol) to spawn Claude
Code. If Raltic became ACP-compatible, OpenClaw would orchestrate
Raltic instead of the reverse. Hermes presumably has its own
analog.

- ✅ Architecturally clean — Raltic agents become a "tool" any
  orchestrator can use.
- ❌ Backwards of what the user asked for.
- ❌ Big API surface.
- DEFER — interesting for a later "Raltic-as-MCP" project.

**Recommendation: Option A**, with a small carve-out in the runtime
interface to express the persistent-daemon lifecycle correctly.

---

## 4. Detailed v1 design (Option A)

### 4.1 Type system changes

`packages/agent-runtime/src/types.ts`:

```ts
// Extend the discriminator. Existing rows in the DB with
// runtime='claude'/'codex' continue to work unchanged.
export type RuntimeId = "claude" | "codex" | "gemini" | "copilot"
  | "openclaw" | "hermes";

// New marker on RuntimeCapabilities — OPTIONAL with default so the
// existing ClaudeRuntime/CodexRuntime/GeminiRuntime/CopilotRuntime
// capability literals don't need touching (codex review MED #3).
export interface RuntimeCapabilities {
  // … existing fields …
  /** "external_daemon" means a separate long-lived process owns the
   *  agent's memory; we call into it per turn. Bridge probes its
   *  liveness via detect() but doesn't spawn/manage it. Defaults to
   *  "per_turn_spawn" when absent — matches Claude/Codex behavior. */
  lifecycle?: "per_turn_spawn" | "external_daemon";
}
```

### 4.2 OpenClawRuntime sketch

`packages/agent-runtime/src/openclaw.ts`:

```ts
const CAPABILITIES: RuntimeCapabilities = {
  models: ["claude-sonnet-4-6", "gpt-5.4", "gemini-2.5-pro"],
  defaultModel: "claude-sonnet-4-6",
  permissionModes: ["readOnly", "default", "acceptEdits"],
  conversational: true,
  resumable: true,                  // daemon owns the conversation
  supportsShellTools: true,
  lifecycle: "external_daemon",
};

export class OpenClawRuntime implements AgentRuntime {
  readonly id = "openclaw" as const;
  readonly displayName = "OpenClaw";
  readonly capabilities = CAPABILITIES;

  async detect(): Promise<DetectResult> {
    // Two-step: binary present AND daemon reachable. If only the
    // binary, surface a clear "run `openclaw onboard` first" hint
    // so the user knows the issue is daemon setup, not install.
    try {
      const { stdout: ver } = await execFileP("openclaw", ["--version"]);
      // Liveness — fast probe, 2s timeout
      try {
        await execFileP("openclaw", ["gateway", "status"], { timeout: 2000 });
      } catch {
        return {
          binary: "openclaw",
          version: ver.trim(),
          authed: false,
          authMethod: "daemon",
          error: "openclaw gateway not running — run `openclaw onboard --install-daemon`",
        };
      }
      return { binary: "openclaw", version: ver.trim(), authed: true, authMethod: "daemon" };
    } catch (e) {
      return { error: `openclaw not installed: ${(e as Error).message}` };
    }
  }

  spawn(opts: SpawnOpts): RuntimeSession {
    return new OpenClawSession(opts);
  }
}

class OpenClawSession implements RuntimeSession {
  // Codex review v2: corrected against the actual contract at
  // packages/agent-runtime/src/types.ts:110-128. send is (text), not
  // (turn). ExitListener is (code: number | null) => void. pid is a
  // readonly property. ActivityEvent shapes are strictly typed.
  readonly pid: number | null = null;     // openclaw spawns per-turn — no stable pid
  private resumeKey: string | null = null;
  private listeners = { activity: [] as ActivityListener[], exit: [] as ExitListener[] };
  private currentProc: ChildProcess | null = null;
  private aborted = false;

  constructor(private opts: SpawnOpts) {}

  async send(text: string): Promise<void> {
    if (this.aborted) throw new Error("session shut down");
    const args = ["agent", "--message", text];
    if (this.resumeKey) args.push("--thread", this.resumeKey);
    if (this.opts.systemPrompt) args.push("--system", this.opts.systemPrompt);
    if (this.opts.model) args.push("--model", this.opts.model);
    args.push("--thinking", mapThinking(this.opts.permissionMode));
    args.push("--json");

    const proc = spawn("openclaw", args, { stdio: ["pipe", "pipe", "pipe"] });
    this.currentProc = proc;
    let buf = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      for (const line of consumeLines(buf, (rest) => { buf = rest; })) {
        const parsed = parseOpenClawEvent(line);
        if (!parsed) continue;
        if (parsed.threadId && !this.resumeKey) this.resumeKey = parsed.threadId;
        // Emit ONLY the discriminated-union shapes ActivityEvent
        // accepts. Unknown event kinds are dropped on the floor; the
        // parser is responsible for never producing an ill-typed event.
        const ev = toActivityEvent(parsed);
        if (ev) this.listeners.activity.forEach(cb => cb(ev));
      }
    });
    await new Promise<void>((resolve, reject) => {
      proc.on("error", reject);
      proc.on("close", (code) => {
        this.currentProc = null;
        // ExitListener is (code: number | null) => void — NOT
        // {code, signal}. Codex review v2 HIGH #1.
        this.listeners.exit.forEach(cb => cb(code));
        if (code === 0) resolve(); else reject(new Error(`openclaw exit ${code}`));
      });
    });
  }

  on(event: "activity" | "exit", cb: ActivityListener | ExitListener): () => void {
    // Standard pattern lifted from ClaudeSession.
    const arr = event === "activity" ? this.listeners.activity : this.listeners.exit;
    arr.push(cb as never);
    return () => {
      const i = arr.indexOf(cb as never);
      if (i >= 0) arr.splice(i, 1);
    };
  }
  getResumeKey() { return this.resumeKey; }
  async shutdown() {
    this.aborted = true;
    if (this.currentProc && !this.currentProc.killed) {
      this.currentProc.kill("SIGTERM");
    }
  }
}
```

**Open questions for build phase**:
1. Verify OpenClaw's exact `agent --json` output shape (tool calls,
   reasoning, final answer) by running it locally with sample
   prompts. The above assumes NDJSON-like; might be a single JSON
   blob. The plan should be tolerant of both via a small parser
   layer.
2. Confirm threading: does `--thread <id>` work, or is the daemon's
   conversation memory implicit? If implicit, `getResumeKey()`
   returns null and the daemon is the source of truth.
3. Verify model passthrough: does OpenClaw accept `--model
   claude-sonnet-4-6` directly, or only its own model-name aliases?
   Build phase task: enumerate via `openclaw agent --help`.

### 4.3 HermesRuntime sketch

`packages/agent-runtime/src/hermes.ts`:

Hermes uses a Unix-socket RPC by default. Two options:
- (a) Shell out to the `hermes` CLI same as OpenClaw.
- (b) Connect directly to the socket (`~/.hermes/sock` per upstream
  docs) and speak its RPC protocol.

V1: option (a) — fewer moving pieces. Option (b) lands as a
follow-up if we hit per-turn-spawn latency issues.

```ts
const CAPABILITIES: RuntimeCapabilities = {
  models: ["auto"],                  // Hermes picks based on its routing rules
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
    // Same shape as OpenClaw: binary check + daemon check.
    // Hermes daemon liveness: `hermes status --json`.
    try {
      const { stdout } = await execFileP("hermes", ["status", "--json"], { timeout: 2000 });
      const status = JSON.parse(stdout);
      if (!status.daemon_running) {
        return { binary: "hermes", version: status.version, authed: false, error: "hermes daemon not running — try `hermes start`" };
      }
      return { binary: "hermes", version: status.version, authed: true, authMethod: "daemon" };
    } catch (e) {
      return { error: `hermes not installed: ${(e as Error).message}` };
    }
  }

  spawn(opts) { return new HermesSession(opts); }
}
```

Same caveats apply — verify the exact CLI shape in build phase.

### 4.4 Registry + bridge changes

`packages/agent-runtime/src/index.ts`:
```ts
import { OpenClawRuntime } from "./openclaw.js";
import { HermesRuntime } from "./hermes.js";

export function buildRuntimeRegistry(): Record<RuntimeId, AgentRuntime> {
  return {
    claude: new ClaudeRuntime(),
    codex: new CodexRuntime(),
    openclaw: new OpenClawRuntime(),
    hermes: new HermesRuntime(),
    gemini: new GeminiRuntime(),       // existing stub
    copilot: new CopilotRuntime(),     // existing stub
  };
}
```

`packages/bridge-core/src/agent-manager.ts:658`:
```ts
const ids: RuntimeId[] = ["claude", "codex", "openclaw", "hermes"];
```

That's it for bridge wiring.

### 4.5 Web UI changes

`apps/web/src/lib/api.ts`:
```ts
export type RuntimeId = "claude" | "codex" | "gemini" | "copilot" | "openclaw" | "hermes";

export const RUNTIME_LABEL: Record<RuntimeId, string> = {
  claude: "Anthropic Claude Code",
  codex: "OpenAI Codex",
  openclaw: "OpenClaw",
  hermes: "Hermes Agent",
  gemini: "Google Gemini CLI",
  copilot: "GitHub Copilot",
};

export const RUNTIME_MODELS: Record<RuntimeId, readonly string[]> = {
  claude: ["sonnet", "opus", "haiku"],
  codex:  ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex-spark"],
  openclaw: ["claude-sonnet-4-6", "gpt-5.4", "gemini-2.5-pro", "auto"],
  hermes:  ["auto"],            // Hermes decides; surface a single option
  gemini:  [...],
  copilot: [...],
};
```

`apps/web/src/components/create-agent-dialog.tsx`:
- Add OpenClaw + Hermes to the runtime picker (visible only when
  the bridge has detected them — derive from
  `me.detectedRuntimes`).
- Cloud-mode (RalticAgent) doesn't change — these are bridge-only
  runtimes.

`apps/web/src/components/setup-wizard.tsx`:
- Step 1 ("Pick a runtime") gets OpenClaw + Hermes as additional
  choices with install commands:
  - OpenClaw: `npm i -g openclaw && openclaw onboard --install-daemon`
  - Hermes: `curl -sSL https://hermes-agent.nousresearch.com/install.sh | sh`
- Wording: "OpenClaw (advanced) — multi-channel personal assistant.
  Pick this if you already use it for Telegram/iMessage."
- Default stays `claude` for new users.

### 4.6 Activity-event mapping

Each runtime emits its own tool-call vocabulary. Existing pattern:
`describeToolUse()` in `claude.ts` maps `Bash`/`Read`/`Write`/etc
to short labels for the UI's activity feed. Mirror this for
OpenClaw and Hermes — each gets a `describeOpenClawTool()` /
`describeHermesTool()` that handles their specific tool names.

Reasonable mapping for v1 (refine in build phase after sampling
real output):
- OpenClaw: `shell` → "Running command", `read_file` → "Reading
  file", `write_file` → "Writing file", `web_search` → "Searching
  web". Fallback `Running ${name}`.
- Hermes: similar; Hermes ALSO has "skills" (built-in auto-created
  skills); emit those as `Using skill: <name>`.

### 4.7 Auth + secrets

OpenClaw/Hermes daemons hold the provider API key themselves —
**Raltic never sees the user's OpenAI/Anthropic key**. This is a
feature: Raltic doesn't take on secret-storage risk for these
keys. The bridge just trusts the local daemon.

The daemon's auth-fail mode (provider key revoked / quota
exhausted) surfaces as a CLI exit code 1 with an error message;
the runtime forwards it to the user via the existing exit-event
handler.

### 4.8 Tests

- Unit: `packages/agent-runtime/test/openclaw.test.ts` and
  `hermes.test.ts` — mock `execFile` + `spawn`, verify detect
  branches, verify the activity-event parser handles malformed
  output without crashing.
- Integration: `apps/bridge/test/openclaw-integration.test.ts` —
  smoke test that spawning a runtime + sending one turn emits
  `activity` events. **Gated by env vars** (codex review LOW #9):
    - `RALTIC_RUN_OPENCLAW_INTEGRATION=1` — require openclaw + daemon
    - `RALTIC_RUN_HERMES_INTEGRATION=1` — require hermes + daemon
- Manual (codex review MED #8 — concrete smoke commands):
  ```sh
  # OpenClaw build-phase verification — run BEFORE writing the parser:
  openclaw --version
  openclaw gateway status
  openclaw agent --help                    # enumerate flags
  openclaw agent --message "say hi" --json # capture exact event shape
  openclaw agent --message "and again?" --thread <id> --json
                                            # verify threading works
  # Hermes build-phase verification:
  hermes --version
  hermes status --json                      # confirm daemon liveness shape
  hermes agent --help                       # OR `hermes chat --help`
  hermes agent --message "say hi" --json
  ```
  Capture stdout to `docs/SAMPLES_openclaw.jsonl` and
  `docs/SAMPLES_hermes.jsonl` so the parser tests can replay real
  output.

### 4.9 Failure-mode matrix

| Scenario | Behavior |
|---|---|
| Daemon not running at spawn-time | detect() returns `authed:false` + error; UI surfaces "daemon offline" badge; sends queue with retry. |
| Daemon dies mid-turn | exit listener fires with code; ActivityEvent emits "agent crashed"; user retries. |
| CLI version mismatch | detect() parses version; major bumps surface a "upgrade openclaw" warning; minor are OK. |
| Provider key invalid | exit code 1 + JSON error; runtime maps to user-facing "auth failed" copy. |
| Turn exceeds tier wallclock | existing AbortController in agent-manager kills the child process. |
| Two concurrent turns for same agent | existing per-agent mutex in agent-manager serialises. |

### 4.10 Backwards compatibility

- DB: `agents.runtime` already free-text — no migration.
- Existing rows: unaffected (only `runtime IN ('claude','codex')`
  exists today).
- Bridge: gracefully ignores OpenClaw/Hermes if user didn't
  install — `detect()` returns error, UI shows "not detected"
  badge in Settings → Runtimes.
- Web: adding new entries to RUNTIME_LABEL/MODELS doesn't break
  older clients (they ignore unknown enum values via the existing
  zod-with-fallback pattern at `apps/web/src/lib/api.ts:34`).

---

## 5. Phased rollout (build phase plan)

Each module reviewed by 1 codex CLI in parallel before moving on.

| Step | Files | Codex review focus |
|---|---|---|
| S1. Type extensions | `agent-runtime/src/types.ts` | `RuntimeId` union safety, capability-flag schema |
| S2. OpenClawRuntime | `agent-runtime/src/openclaw.ts` | spawn safety, NDJSON parsing, resume-key handling |
| S3. HermesRuntime | `agent-runtime/src/hermes.ts` | same as S2 |
| S4. Registry + detect-list | `agent-runtime/src/index.ts`, `bridge-core/src/agent-manager.ts` | enum exhaustiveness, detect timeout sanity |
| S5. Web RUNTIME maps | `apps/web/src/lib/api.ts` | type sync, model labels |
| S6. Create-agent picker | `apps/web/src/components/create-agent-dialog.tsx` | conditional render on detection, default selection |
| S7. Setup wizard runtime row | `apps/web/src/components/setup-wizard.tsx` | install command copy, error states |
| S8. Activity-event mappers | `agent-runtime/src/{openclaw,hermes}.ts` | tool-name coverage, graceful unknown fallback |
| S9. Unit tests | `agent-runtime/test/` | mock surface, edge cases |
| S10. Local dogfood | run bridge against real daemons | "first conversation" UX, latency, errors |

Final pass: **10 Claude Code + 10 codex CLI agents** as the user
specified — 20 angles on the cumulative diff (security, UX, error
recovery, performance, mobile, accessibility, i18n, etc).

---

## 6. Risks + known unknowns

| Risk | Mitigation |
|---|---|
| OpenClaw/Hermes CLI shape evolves | Pin minimum versions in `detect()`; surface clear upgrade prompts. |
| Per-turn shell-out latency too high (200-500ms overhead) | V1 ships; if slow, follow-up adds direct RPC for Hermes (Unix socket already published). |
| OpenClaw threading model unclear | Build-phase task #1 — confirm via real CLI sampling before writing the parser. |
| Hermes installation requires sudo on macOS | Document in wizard; users install before opening Raltic, like Claude/Codex today. |
| Provider API key billing — user expects "free" but daemon charges OpenRouter | Surface a "this runtime uses your own API key" disclaimer in the picker. |
| Bridge becomes a fat client (4 detect() calls at boot, each up to 2s) | Run detects in parallel via `Promise.allSettled` — already the pattern. |

---

## 7. Out of scope (deferred)

- ACP-compatibility (Option C above) — make Raltic an orchestratable
  agent from OpenClaw's perspective.
- HermesRuntime over Unix socket directly (skip CLI shell-out).
- OpenClaw skill marketplace integration (use ClawHub from Raltic).
- Multi-machine bridge (run OpenClaw on machine A, bridge on
  machine B) — would need Option B's HTTP registration model.

---

## 8. Approval gate

Before building, this plan needs:
1. Codex CLI review of THIS DOCUMENT (architectural soundness).
2. User confirmation to proceed.

After build:
- Per-module codex review (10 steps × 1 codex each, parallel).
- Final 10 Claude Code + 10 codex CLI multi-angle review.
- Dogfood with real OpenClaw + Hermes installs locally.

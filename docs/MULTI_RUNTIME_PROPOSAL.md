# Bridge multi-runtime support — proposal

**Status:** draft / for review  
**Author:** generated 2026-05-17  
**Scope:** extending `apps/bridge` to spawn AI agent CLIs other than Claude Code (initial targets: OpenAI Codex, OpenClaw, Hermes Agent)

This is a **research + design document**, not a patch. The goal is to be honest about what's known, what's unknown, and what we'd have to verify before committing engineering time. The current bridge is built tightly around Claude Code's specific CLI; the question is whether the abstraction can support 3+ other CLIs without becoming a leaky mess.

---

## 0. TL;DR

* **Feasible, with caveats.** The work splits cleanly into three layers (spawn, stream IO, normalised activity events) and is well-isolated to `apps/bridge`. Web UI, API, schema, and product surfaces get *small* changes.
* **The hard part is not the abstraction** — it's the long tail of CLI-specific quirks (session resume, permission model, tool injection, model naming, auth). Each runtime needs days of careful integration work and ongoing maintenance as the upstream CLI evolves.
* **Open blockers before we can plan execution:**
  1. **OpenClaw / Hermes Agent need disambiguation** — neither is a well-known product name to me. The doc currently treats them as placeholders.
  2. **Per-agent vs per-bridge runtime** is a UX decision (see §6).
  3. **Auth strategy for non-Anthropic runtimes** is undecided (see §7).

Once 1–3 are resolved, Phase 1 (the abstraction + Claude refactor) is ~2 days, with each subsequent runtime ~2–4 days of focused work + an unknown amount of "the CLI changed its JSON shape" maintenance.

---

## 1. Where we are today

`apps/bridge/src/agent-manager.ts` does the following for every agent:

```ts
spawn("claude", [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--append-system-prompt", systemPrompt,
  "--allowedTools", "Read,Glob,Grep,WebSearch,WebFetch,Bash(raltic …)",
  "--permission-mode", "acceptEdits",   // or bypassPermissions
  "--model", "opus" | "sonnet" | "haiku",
  ...(sessionId ? ["--resume", sessionId] : []),
], { cwd: workDir, env: { …, RALTIC_AGENT_ID, RALTIC_API_URL, RALTIC_AGENT_TOKEN, PATH: `${ralticDir}:${PATH}` } });
```

Stream protocol it speaks:

* **stdin (NDJSON):** `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}`
* **stdout (NDJSON events):**
  * `{"type":"system","subtype":"init","session_id":"…"}` — session id surfaces here for resume
  * `{"type":"assistant","message":{"content":[{"type":"thinking"|"text"|"tool_use", …}]}}`
  * `{"type":"result","session_id":"…"}` — turn complete

Agents act in the world via a `raltic` CLI wrapper that bridge writes into `<workDir>/.raltic/raltic` and prepends to `PATH`. The agent calls it from a Bash tool (`raltic message send`, etc.). That whole mechanism assumes the CLI grants Bash access to the agent — which is a Claude-Code-shaped concept.

**Things in the current code that are Claude-specific** (and will need a strategy per-runtime):

| Concern | Claude Code today | Why it's hard to generalise |
| --- | --- | --- |
| Process command | `claude` on `PATH` | Each CLI has its own binary name + install path. |
| stdin envelope | `{"type":"user","message":{...}}` | Other CLIs may take plain text on stdin, or wrap differently. |
| stdout event shapes | `{type:"assistant", message:{content:[{type:"tool_use"...}]}}` etc. | Codex/etc. emit different JSON; tool-call shape varies wildly. |
| Session resume | `--resume <session_id>`, id read from `system.init` event | Some CLIs scope sessions per-directory and have no explicit resume flag. |
| Permission model | `--permission-mode` + `--allowedTools` | Codex uses sandbox levels; others may have no permission system at all. |
| Tool surface | A documented set of built-ins (Read, Glob, Grep, Bash, WebSearch, …) | Each CLI ships its own toolset. If `Bash` doesn't exist, our `raltic` CLI injection breaks. |
| Model naming | `opus`/`sonnet`/`haiku` | Codex uses `gpt-5`/`gpt-5-mini`/…; Hermes uses different model ids; etc. |
| Auth | Claude Code reads `claude` CLI's own config (Anthropic API key or Pro/Max sub) | Codex needs OpenAI auth; Hermes may need its own. We have no plumbing for the user to manage these. |
| Agent system prompt | `--append-system-prompt` flag | Some CLIs only accept system prompt via a settings file or env var; some interpret instructions literally vs prepend-to-default. |

---

## 2. Target runtimes — what we know, what we don't

I've split each target into **what I'm reasonably confident about** vs **what needs upstream investigation before integration can begin**. The latter is where we MUST get answers — guessing will produce broken integrations.

### 2.1 Claude Code (Anthropic)

✅ Reference implementation. Already shipping. Fully understood.

### 2.2 OpenAI Codex CLI

* **What I'm reasonably confident:**
  * Binary distributed as `@openai/codex` (npm) or a native install (depending on version).
  * Supports a streaming-JSON IO mode similar in spirit to Claude Code's `stream-json`.
  * Has a sandbox/permission concept (different naming than Claude's `--permission-mode`).
  * Models named `gpt-5`, `gpt-5-mini`, plus reasoning variants.
* **What I need to verify before implementing:**
  * **Exact CLI invocation** for headless / non-TTY use (`codex exec` / `codex --json` / something else — the CLI's modes change between versions).
  * **stdin and stdout event shapes** — I don't want to write a parser from memory; I want to capture a real session and grep the event types.
  * **Session resume mechanism** — does Codex use a session id like Claude? Persisted in a file? Or stateless per-invocation?
  * **System prompt injection** — flag, settings file, env, or in-band on the first user message?
  * **Bash-equivalent tool** — does Codex expose a shell tool, and does it honour our `PATH` prepending? Without this, the `raltic message send` mechanism doesn't work as-is.
  * **Permission/sandbox model** — how do we map our "acceptEdits / bypassPermissions" UX onto Codex's sandbox levels (and vice-versa, so we don't lie to users)?
  * **Auth** — Codex reads an OpenAI API key from where? If it's in `~/.codex/`, the bridge doesn't need to do anything. If we have to surface it in Raltic settings, that's a real UX project (§7).

### 2.3 OpenClaw

* **What I know:** nothing concrete. The name is not familiar to me. I want to avoid fabricating CLI details for a product I don't have on hand.
* **Need from you:** the project URL / GitHub repo / install command. Once I have those I can fill in the same checklist as §2.2.

### 2.4 Hermes Agent

* **What I know:** "Hermes" is a model family from Nous Research, but Nous distributes model weights, not an agent CLI. "Hermes Agent" might be:
  * a specific company's product I don't know,
  * a community-built CLI wrapping Hermes models,
  * an agent framework that *uses* Hermes as the model.
* **Need from you:** the exact product reference. Same checklist as §2.2 once known.

> **Action item before writing code for §2.3/§2.4:** capture one real headless session of each CLI (`<cli> --help`, a sample non-interactive run, stdout dump). Without those, integration estimates are guesses.

---

## 3. Proposed abstraction

The minimum useful interface — anything more is speculative and we add it on real need.

```ts
// packages/agent-runtime/src/types.ts
export type RuntimeId = string;             // "claude" | "codex" | "openclaw" | "hermes" | …

export interface RuntimeCapabilities {
  /** Does this runtime accept stdin messages mid-session, or is it
   *  one-shot (each prompt is a new spawn)? */
  conversational: boolean;
  /** Can we resume an old session by id? */
  resumable: boolean;
  /** Does the runtime expose a Bash-equivalent that the agent can use
   *  to invoke our `raltic` CLI? If false we need a different
   *  message-send path (e.g. an HTTP tool the runtime exposes). */
  supportsShellTools: boolean;
  /** Per-runtime model identifiers we surface in the UI. */
  models: string[];
  /** Coarse permission options we expose (not all map cleanly). */
  permissionModes: ("default" | "acceptEdits" | "bypassPermissions")[];
}

export interface SpawnOptions {
  workDir: string;
  systemPrompt: string;          // already brand/role-translated by caller
  model: string;                 // must be one of capabilities.models
  permissionMode: string;
  allowedTools: string[];        // runtime decides how to honour
  resumeKey?: string;            // sessionId from a prior turn
  /** PATH + RALTIC_AGENT_* envs the runtime should inherit. */
  env: Record<string, string>;
}

export interface RuntimeSession {
  readonly pid: number;
  /** Write a user message into the running session.
   *  Throws if !conversational or process is dead. */
  send(text: string): Promise<void>;
  /** Stream of normalised activity events the bridge already understands. */
  on(event: "activity", cb: (a: ActivityEvent) => void): void;
  on(event: "exit", cb: (code: number | null) => void): void;
  /** Stable resume key to persist for `--resume`-style continuity. */
  getResumeKey(): string | null;
  shutdown(): Promise<void>;
}

export type ActivityEvent =
  | { kind: "thinking" }
  | { kind: "working"; tool: string; label: string; detail: string }
  | { kind: "text"; text: string; final: boolean }
  | { kind: "turn_complete"; sessionId: string }
  | { kind: "error"; message: string };

export interface AgentRuntime {
  readonly id: RuntimeId;
  readonly displayName: string;
  readonly capabilities: RuntimeCapabilities;

  /** Verify the CLI is installed + reachable. Surface to bridge logs
   *  and to the UI ("Codex not installed — install it with …"). */
  detect(): Promise<{ binary: string; version: string } | { error: string }>;

  spawn(opts: SpawnOptions): RuntimeSession;
}
```

### Why this shape

* `ActivityEvent` is the existing vocabulary the bridge → API → web pipeline already speaks; we don't have to change downstream.
* `RuntimeCapabilities` is the contract the UI uses to grey out unsupported options (e.g. don't show "Resume conversation" toggle if `!capabilities.resumable`).
* `detect()` lets us fail loudly at agent-create time ("you picked Codex but it's not installed") instead of silently breaking on first message.
* `spawn()` returning a `RuntimeSession` (not a Promise) is intentional — same shape as `child_process.spawn`, gives the caller an EventEmitter-style object.

### What lives in each runtime adapter

`ClaudeRuntime` — extracted from the current `agent-manager.spawnProcess` + `handleStreamEvent`. Most of the existing code moves into this file unchanged.

`CodexRuntime` — needs a stdout JSON parser tailored to Codex's event shapes, a different argv constructor, a session-resume strategy (TBD per §2.2), and a strategy for the `raltic` CLI injection (if Codex doesn't expose a freeform Bash tool, we may need to surface our chat operations as a tool the runtime can call — a bigger lift).

`OpenClawRuntime`, `HermesRuntime` — gated on §2.3/§2.4 disambiguation.

### Selecting a runtime

`AgentManager` reads `agent.runtime` (new schema column, default `"claude"`) and dispatches via a registry:

```ts
const RUNTIMES: Record<RuntimeId, AgentRuntime> = {
  claude: claudeRuntime,
  codex: codexRuntime,
  // openclaw, hermes added later
};
```

---

## 4. What needs to change outside `apps/bridge`

This is small but real:

| Change | Where | Effort |
| --- | --- | --- |
| `agents.runtime` text column (default `"claude"`) | `packages/db/schema.ts` + migration | 5 min |
| `runtime` field in `Agent` type + `createAgentRequest` schema | `packages/protocol/src/rest.ts` + `apps/web/src/lib/api.ts` | 10 min |
| Runtime picker on create-agent dialog (only shown if user has more than one detectable runtime) | `apps/web/src/components/create-agent-dialog.tsx` | 30 min |
| Per-runtime model list (drop the hardcoded `opus/sonnet/haiku` triple in EditAgentDialog) | `apps/web/src/components/edit-agent-dialog.tsx` | 20 min |
| Bridge `/api/v1/bridge/connect` returns a `runtimes` array (which CLIs are installed on the user's machine) so the UI can grey out picker options it can't satisfy | bridge boot payload + `apps/api/src/routes/bridge.ts` | 30 min |
| System prompt per-runtime conditional — the existing prompt has a "Communication — raltic CLI ONLY" section that assumes Bash access. For runtimes without a shell tool we'd need an alternate prompt + an alternate send mechanism. | `apps/bridge/src/system-prompt.ts` | 1–2 days (design decision, not just code) |

---

## 5. Authentication: the under-explored part

Claude Code is uniquely friendly here — it manages its own auth (`claude` CLI handles either an API key or a Pro/Max OAuth subscription, persisted in `~/.claude/`). The bridge never touches Anthropic credentials.

If we add Codex, the user has to have an OpenAI API key (or a ChatGPT account if Codex supports OAuth subscription auth). Options:

1. **Delegate entirely to each CLI** — same as Claude today. If `codex` is installed and authenticated, we just spawn it. UX: user runs `codex login` themselves once. Downside: zero visibility from Raltic if it's NOT authed; user discovers it on first failed message.
2. **Surface credentials in Raltic settings** — UI lets the user paste an OpenAI key, bridge exports it as `OPENAI_API_KEY` to the spawned Codex process. Downside: we're now storing third-party credentials, which has compliance + security implications. We'd need encryption at rest, scoped keys, etc.
3. **Hybrid** — delegate by default, offer a "paste a key" override for runtimes whose CLI doesn't auto-detect.

**Recommendation:** start with (1) — match the Claude pattern. Add (2) as a follow-up if users find (1) painful. Build (3) only if we have evidence we need both paths.

---

## 6. UX decisions to make (need product input)

### 6.1 Runtime granularity

Two options:

* **Per-agent** (recommended) — each agent in the DB has its own `runtime`. "Reviewer" can be Claude (Sonnet) while "Research Agent" is Codex (gpt-5). The user picks at create time. This makes the platform feel like "AI teammates, choose their brand of brain."
* **Per-bridge** — one bridge process speaks only one runtime; user needs to run multiple bridges (one per machine *and* runtime). Simpler engineering, but limits the product story.

I strongly recommend per-agent. The work isn't materially harder and the product narrative ("your AI teammates can be from different providers") is much stronger.

### 6.2 Discovery

When user lands on "Create agent" page, they pick a runtime. Options:

* Show all known runtimes, mark "not installed" with an install hint.
* Show only installed runtimes — if user wants more, send them to docs.
* Always show, but disable picker options whose `runtime.detect()` failed at bridge boot.

Recommendation: third option — visibility + actionable error.

### 6.3 Model name surfacing

Each runtime's models change frequently. Hard-coding `["opus", "sonnet", "haiku"]` will rot. Options:

* Hard-coded per-runtime list in TypeScript, maintained by us.
* Ask the runtime CLI (most have a `<cli> models` or similar command). Bridge surfaces them in `/bridge/connect`.

Recommendation: ask the CLI when possible; fallback to a hardcoded list per runtime if the CLI doesn't expose this.

### 6.4 System prompt strategy

Today's prompt is hand-tuned for Claude Code (it tells the agent to use `raltic` Bash tool, mentions thread suffixes, etc.). For runtimes without a Bash tool the prompt would need to instruct the agent to use a different mechanism. Two paths:

* **Common prompt + runtime-specific addendum** — keep the role/persona/style sections shared, append runtime-specific tool instructions.
* **Per-runtime prompt files** — fully separate templates per runtime. More work to maintain but cleaner.

Lean toward the first; it's less duplication and our role/persona content is already 90% of the prompt by length.

---

## 7. Risks (ranked)

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| 1 | Codex / OpenClaw / Hermes stream format **changes between versions**, breaking the bridge's parser silently | High — silent failures look like "agent doesn't reply" | Version-aware parsers; refuse to spawn if `cli --version` reports an unknown major; CI smoke tests against pinned CLI versions |
| 2 | A target runtime has **no shell-equivalent tool**, so our `raltic` CLI injection mechanism doesn't transfer | High — the entire send-message mechanism is rebuilt | Build an alternative: bridge exposes `raltic` operations as runtime-native tools (e.g. as a function the runtime can call), bypassing shell. Significant rework. |
| 3 | **Auth UX** (user has to install + log in to 4 different CLIs to use the picker) is too high-friction | Medium — kills adoption of non-Claude runtimes | Surface clear install/login instructions inline in the agent-create flow per runtime; consider managed Bring-Your-Own-Key path (§5) |
| 4 | **Permission model mismatch** — Codex's sandbox levels don't map 1:1 to Claude's permission modes | Medium — UX is honest but lossy | Surface runtime-specific permission options instead of trying to harmonise; the abstraction's `permissionMode: string` is intentionally not enum to support this |
| 5 | Multiple runtimes installed on the same machine may **fight over global state** (config dirs, port usage, model caches) | Low–Medium | Mostly the CLIs' problem; bridge should set `cwd` consistently and not share env between spawned processes |
| 6 | Some runtimes **may not support multiple concurrent sessions** on the same machine | Medium — would limit how many agents a user can run | Detect at runtime; surface as `RuntimeCapabilities.maxConcurrent` (extend the interface) and have AgentManager queue accordingly |
| 7 | **Maintenance cost balloons** — supporting N runtimes means N upstream changes to track | Medium ongoing | Pick runtimes deliberately; deprecate aggressively if a runtime is abandoned; CI canary tests per runtime |

---

## 8. Suggested phased plan

### Phase 0 — Disambiguate the unknowns (days, mostly waiting)

Block on:
* Get OpenClaw / Hermes Agent references from you.
* Capture one headless session per target CLI (you or me, depending on access). Save the stdout NDJSON to `docs/runtime-traces/` so we can write parsers without guesswork.
* Decide §6.1 (per-agent vs per-bridge) — **strong recommendation: per-agent**.
* Decide §6.2 (auth strategy) — **recommendation: delegate to each CLI, BYOK as v2**.

### Phase 1 — Extract `AgentRuntime` interface + `ClaudeRuntime` (1–2 days)

* Create `packages/agent-runtime/` with the interface from §3.
* Move existing `spawnProcess` + `handleStreamEvent` code into `ClaudeRuntime`.
* `AgentManager` consumes the runtime via the registry, not directly.
* Behaviour identical to today; verified by existing manual tests.

### Phase 2 — Schema + UI plumbing (½ day)

* Add `agents.runtime` column + migration.
* Update protocol types, web `Agent` type, edit/create dialogs.
* Bridge `/connect` returns `runtimes: [{id, detected, version, error?}]`.

### Phase 3 — `CodexRuntime` (2–3 days assuming Phase 0 traces in hand)

* Argv constructor, stdin encoder, stdout parser, session resume strategy.
* Real end-to-end test with `cornerprince1990@gmail.com` account.
* Document quirks; gate Codex picker on `detect()` success.

### Phase 4 — `OpenClawRuntime` / `HermesRuntime` (gated on Phase 0)

* Same shape as Phase 3, scope TBD until we know what they are.

### Phase 5 — Polish

* Per-runtime prompt addenda (§6.4).
* Per-runtime model name fetch (§6.3).
* Settings-page management of optional API keys if we pursue §5.2.

### Estimated total

If Phase 0 questions are answered today: **6–10 engineering days** for full Phase 1–3 (Claude + Codex working end-to-end), with Phases 4–5 added when scope is known.

---

## 9. Questions for you before we commit

These genuinely block design — please answer each:

1. **OpenClaw** — link/repo/install command?
2. **Hermes Agent** — same?
3. **Runtime granularity** — per-agent (recommended) or per-bridge?
4. **Auth UX** — start with "user installs + logs into each CLI themselves" (recommended) and add BYOK later? Or do you want BYOK in v1?
5. **Initial scope of v1** — ship Claude + Codex first as a real two-runtime release, then add OpenClaw/Hermes incrementally? Or wait until all 4 are ready?
6. **Are non-coding agents on the table?** — some of these CLIs may not be coding agents specifically. Does our "agent talks to channels via `raltic` CLI" pattern still apply, or do we need a separate runtime model for, say, RAG-only agents?

Once 1–4 are answered I can produce a sharper PR breakdown with file-level diffs and effort per PR.

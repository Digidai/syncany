# Syncany — Agent Team Evaluation (5 rounds, 6 reviewers)

> **Date**: 2026-05-12
> **Live**: https://syncany-web.genedai.workers.dev (web), https://syncany-api.genedai.workers.dev (api)
> **Composite grade**: **D+**
> **Verdict**: DO NOT SHIP to untrusted users. Tier S blocker on agent reply path verified live.

## Method

Five-round independent review using a rotating cast of evaluators:

| Round | Focus | Reviewer A | Reviewer B |
|---|---|---|---|
| R1 | Architecture & code quality | code-reviewer agent | (Codex CLI silent — see methodology note) |
| R2 | Security | Gemini CLI 0.39.1 | bug-analyzer agent |
| R3 | Product / UX | Gemini CLI | general-purpose PM agent |
| R4 | Performance & scaling | (Codex CLI silent) | — |
| R5 | Synthesis | Gemini CLI | general-purpose synthesizer |

**Methodology note**: Codex CLI 0.128.0 invocations under `codex exec --skip-git-repo-check --sandbox read-only` produced 0-byte output even with `-o file` flag. Two retries timed out (5+ min, no stdout/stderr). All other rounds had two independent reviewers cross-check each other; R1 and R4 ended up single-source. Findings flagged below were independently triangulated against R5 input bundle and against the live API.

---

## TIER-RANKED FINDINGS

### Tier S — fired/sued/CVEed within 30 days

#### S1. Bridge → CLI auth path returns 401 (LIVE-VERIFIED)
- `apps/api/src/index.ts:154-173` only matches `Bearer ck_` and `Bearer cw_api_` prefixes
- `apps/bridge/src/agent-manager.ts:371` and `packages/cli/src/index.ts:60` send `Bearer ${wsToken}` (raw HS256 JWT, no prefix)
- `resolveSubject` returns `null` → 401 UNAUTHENTICATED
- **Live confirmation**:
  - `Bearer <wsToken>` → HTTP 401
  - `Bearer cw_api_<wsToken>` → HTTP 200
- **Impact**: every CLI call from a spawned agent fails. The npm-published agent reply loop **does not work end-to-end on production**. The "live demo" only covers the web→DO WS path.
- **Fix**: 5 lines. Add a third prefix `cw_bridge_` (or detect bridge tokens by `claims.bridgeId` and accept raw HMAC fallback).

#### S2. Machine key (`ck_…`) is unscoped to its server
- `packages/auth-core/src/machine-keys.ts:23-48` stores `serverId` per key
- `apps/api/src/index.ts:154-162` returns `{ kind:"machine", userId, serverId }`
- **No `policy.*` helper ever consults `subject.serverId`** (`packages/auth-core/src/policy.ts:161-212`)
- **Impact**: a leaked `ck_` for server A is full account takeover across **every server the user belongs to**. Owner can't tell legit from leaked because the only audit trail is `lastUsedAt`.
- **Fix**: enforce `targetServerId === subject.serverId` in every server-scoped policy when `subject.kind === "machine"`.

#### S3. Cross-user UserGateway WS subscription
- `apps/api/src/index.ts:1174` picks DO by URL `userId` parameter, no assertion that `subject.userId === url.userId`
- `packages/chat-room/src/user-gateway.ts:144` `broadcast()` fans every notify to **all sockets** in the DO with no `attached.userId` filter
- **Impact**: any authenticated user can subscribe to any other user's notification stream — read presence, channel-add events, RPC payloads, mark-read events for the victim.
- **Fix**: assert subject identity at the upgrade route AND filter broadcast by attached recipient.

### Tier A — ship-blocker against typical user

| ID | Issue | Where | Fix size |
|---|---|---|---|
| A1 | `bypassPermissions` + verbatim message → host RCE | `apps/bridge/src/agent-manager.ts:240` + `dispatchInboundMessage:105` | 1 line + opt-in flag |
| A2 | `policy.tasks.canManage = canRead` — any reader can mutate tasks | `packages/auth-core/src/policy.ts:200-203` | 5 lines |
| A3 | `createChannel` doesn't validate `initialAgentIds` ownership — drop victim agent into attacker channel | `apps/api/src/index.ts:790-812` | 10 lines |
| A4 | Public-channel IDOR via `channelIsPublic` short-circuit; non-server-members can read/rename | `policy.ts:175-178` | refactor `canRead` |
| A5 | `wsToken` 7-day TTL with no revocation; rotating `CHAT_ROOM_AUTH_SECRET` invalidates *all* users | `auth-core/ws-token.ts:18-42` | KV deny-list + jti |
| A6 | `PATCH /channels/:id` reuses `canRead` (not `canUpdate`) | `apps/api/src/index.ts:746-757` | 1 line |
| A7 | `tasks` POST hack writes `seq=0` system message — bypasses DO sequencer + `taskNumber` race (read-modify-write, no transaction) | `apps/api/src/index.ts:865-903` | route through DO |

### Tier B — first-100-user retention blocker

- **Local bridge gate kills 73% of signups** (PM funnel estimate). Node ≥20 + `claude` CLI install requirement is unaccept­able for non-developers.
- **Multi-machine = double-reply**. Already documented but no mitigation. Launch-blocker for the team-SaaS positioning.
- **Task Board title-erasure**. Cards show only `#N` because task table doesn't store title — it's stuck in a linked system message and the UI never joins back. Feature is functionally useless.
- **No marketing page** — `/` is the app shell, not a pitch. Cannot run paid acquisition.
- **No analytics SDK wired** — grep for posthog/mixpanel/amplitude/segment returns 0. Cannot measure PMF.
- **No billing, no quotas** — anyone can hammer D1+DO bandwidth.
- **`window.prompt()` for message editing** — placeholder UI never promoted to a real component.
- **Email verification required for `@syncany.local` test addresses bounce** — no eval/sandbox bypass.
- **In-memory better-auth rate limit** — useless across Cloudflare isolate spread; Resend budget abuse vector.
- **Bridge `ws-token` not refreshed** — sidebar live state and CLI poll loop both die after 10 min.

### Tier C — polish (won't block scale)

- `apps/api/src/index.ts` is **1,183 lines** (4 inline `:any`, no Hono `app.route()` grouping, inline auth shortcuts)
- 4 near-identical HS256 signers/verifiers across files (`auth-core/ws-token.ts`, `apps/api/src/index.ts:177`, `chat-room.ts:453`, `user-gateway.ts:122`); UserGateway uses non-constant-time compare
- No JWT `alg` header validation — `{"alg":"none"}` would not be rejected
- Magic numbers throughout (`ALARM_DELAY_MS=250`, `MAX_PENDING_BATCH=50`, body `2_000_000`, etc.)
- `LIKE '%q%'` search will not survive 100k messages — no FTS5 virtual table
- Markdown image URLs not gated — agents can beacon viewer IPs
- Zero automated tests on a system whose correctness depends on single-threaded DO assumptions
- Dead code: `policy.messages.canSendAs` system branch is unreachable

---

## CONSENSUS (3+ reviewers independently agreed)

1. **`bypassPermissions` + prompt-injection = host RCE** — flagged by Gemini-Sec, bug-analyzer, PM
2. **`tasks.canManage = canRead` is broken authz** — code-reviewer #3, bug-analyzer #3, Gemini-UX
3. **Public-channel / cross-tenant IDOR via `channelIsPublic` short-circuit** — Gemini-Sec #4, bug-analyzer #1+#4, code-reviewer #3
4. **No tests, no analytics, monolith file = same execution-discipline gap** — code-reviewer #2, PM #3, Gemini-UX
5. **Bridge-on-laptop is the load-bearing flaw** — PM ("fatal for team-wide reliability"), Gemini-UX ("Critical friction #1"), context.md itself ("multi-machine = double-respond")

## DISAGREEMENT (resolved)

- **Security C- (Gemini) vs D+ (bug-analyzer)** → bug-analyzer wins. Gemini missed the unscoped `ck_` machine key and the cross-user UserGateway subscription. Categorical authz holes, not hardening.
- **Architecture B- (code-reviewer) vs Product C- (PM)** → both right at different layers. Engineering craft is genuinely B/B-; product wrapper is C-. Engineering competence does not rescue an unvalidated wedge.
- **UX B- (Gemini)** is too generous — doesn't account for the bridge-auth 401 above.

---

## TOP-OF-MIND ACTION (tomorrow morning, ~2 hours)

**Single PR**:

1. Fix bridge auth 401 — extend `resolveSubject` (`apps/api/src/index.ts:154`) to handle bridge wsTokens; OR change bridge + CLI to send `Bearer cw_api_${token}`
2. Add `subject.serverId` enforcement in `policy.servers.canRead/canUpdate`, `policy.agents.*`, `policy.channels.*` when `subject.kind === "machine"`
3. Add a Vitest in `packages/auth-core` covering both gates so they don't regress

Without this, the npm-published agent reply path does not work, AND a leaked `ck_` is account takeover across all servers. Until both ship, no other work matters.

---

## THREE ALTERNATIVE PRODUCT FRAMINGS

The data supports a positioning pivot. PM agent + Gemini-UX both agree the team-SaaS framing is unwinnable. Defensible alternatives:

1. **"Tasker for overnight Claude jobs"** — mobile-first remote control of long-running Claude Code sessions on the user's laptop. The bridge-on-laptop liability becomes a feature: the agent runs where the code is. Push notif + iOS reply is an uncontested lane today.

2. **"Local AI GUI for one user"** — drop the team pretense. $9/mo single-user, HN launch, Mac-app feel. Low TAM but defensible and shippable in a week.

3. **"Claude Code shared-context sidecar"** — reposition as the shared memory graph across many Claude Code sessions. Chat UI is one view onto the graph. The only framing with a real moat (today, agent memory accrues to the user's laptop, not the SaaS).

---

## COMPOSITE GRADE: **D+**

Engineering craft is genuinely B-/B — DO-as-seq-oracle is correct, monorepo cuts are clean, HMAC-WS-subprotocol is clever, idempotency + alarm flush is thoughtful Cloudflare-native design.

But a product is graded on what a user can do today, not what the architecture diagram promises. Today: the npm package 401s on the agent reply path. A leaked machine key is account takeover. Any logged-in stranger can wiretap your notify stream. Prompt-injection RCE on your laptop is one message away. PM is right there's no landing page, billing, or funnel. Architect is right the bones are good. They describe the same project; the bones don't ship, the holes do.

**D+ — exactly where bug-analyzer landed, for the same reasons.**

---

## Per-reviewer raw outputs

- `/tmp/syncany-eval/r1/code-reviewer.md` — Architecture B-
- `/tmp/syncany-eval/r2/gemini.md` — Security C-
- `/tmp/syncany-eval/r2/bug-analyzer.md` — Security D+
- `/tmp/syncany-eval/r3/gemini.md` — UX B-
- `/tmp/syncany-eval/r3/pm.md` — Product C-
- `/tmp/syncany-eval/r5/gemini.md` — Synthesis D+
- `/tmp/syncany-eval/r5/synthesizer.md` — Synthesis D+

(Codex CLI output unavailable — see methodology note. Both R1 and R4 codex invocations hung indefinitely under sandboxed `exec` mode.)

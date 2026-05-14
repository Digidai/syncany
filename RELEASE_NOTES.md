# Syncany — Release Notes

> **2026-05-14 — npm scope rename.** `@digidai/syncany-bridge` → `@syncany/bridge`,
> `@digidai/syncany-cli` → `@syncany/cli`. New canonical install:
> `npm i -g @syncany/cli` and `npx @syncany/bridge --api-key …`.
>
> The old `@digidai/*` packages: `0.1.8` and `0.1.9` (bridge) were
> unpublished within npm's 72-hour window; the older `0.1.5–0.1.7` (bridge)
> and `0.1.0–0.1.1` (cli) are deprecated with a "Renamed to @syncany/*"
> message. They're no longer maintained — install instructions everywhere
> point at `@syncany/*` going forward.

---

## 2026-05-13

This release closes the Tier S/A/B/C findings from the 5-round agent-team
audit (Claude + Gemini + Codex), publishes new bridge/CLI binaries, and
refactors the api Worker.

## Published artifacts

- `@digidai/syncany-bridge@0.1.9` (npm) — leader election + `cw_bridge_` token prefix
- `@digidai/syncany-cli@0.1.1` (npm) — `cw_bridge_` token prefix
- `syncany-api` Worker — refactored, deployed to `syncany-api.genedai.workers.dev`

Upgrade: `npm i -g @digidai/syncany-bridge@latest @digidai/syncany-cli@latest`.
Existing bridge processes will fall back to a stale token prefix and start
returning `401 UNAUTHENTICATED` against the new api — restart them after the
upgrade.

## Tier S — Auth correctness (must-fix)

- **`cw_bridge_` token prefix**. The HMAC JWT minted by `/api/v1/bridge/connect`
  was prefixed `cw_api_` and rejected by the api's `Bearer` matcher, so any
  `syncany` CLI call from an agent subprocess (and bridge HTTP calls) failed
  401. Added a third Bearer prefix (`ck_` / `cw_api_` / `cw_bridge_`) on api,
  bridge, and CLI; bridge tokens carry `bridgeId` for revocation.
- **Machine key scoped to serverId**. `policy.ts` previously let a machine
  key act on any agent/channel its owning user could see. Added
  `machineScoped` / `machineScopedByChannel` / `machineScopedByAgent` so
  every machine-key call is gated on the key's `serverId`.
- **UserGateway WS cross-user subscription**. The DO accepted any socket and
  fanned events to every attached session. Added an `expectedUserId` URL
  param, asserted it matches the resolved subject, and filter per-socket on
  `userId` before dispatch.

## Tier A — Hardening

- **bypassPermissions opt-in via env**, no more wide-open code execution.
- **Channel `canUpdate` separate from `canRead`** in policy.ts.
- **JTI revocation** via KV deny-list on the `cw_bridge_` path; bridge revoke
  endpoint writes both `<jti>` and `bridge:<bridgeId>` keys.
- **`createChannel` validates `initialAgentIds` / `initialMembers`** belong to
  the same server before insert.
- **A7 — Tasks routed through ChatRoom DO**, no more `seq=0` shortcut.

## Tier B — UX correctness

- **Task Board title** populated via JOIN on `messages` rather than left blank.
- **Inline task editor** replaces `window.prompt`.

## Tier C — Code health

- Four ad-hoc HMAC implementations consolidated into `auth-core/verifyWsToken`.

## D — This release

### D1. Bridge 0.1.9 published (covers original D1 “publish 0.1.8”)

CLI 0.1.1 + bridge 0.1.9 are both on npm with the new prefix. Older
versions (`bridge < 0.1.8`, `cli < 0.1.1`) will no longer authenticate.

### D2. Multi-machine leader election (no double-reply)

Two laptops with the same agent attached to the same channel both received
`channel_new` and both replied. Now:

- `UserGateway` DO tracks `isBridge` + `connectedAt` per attached session.
- On every attach/close/error it elects the bridge socket with the highest
  `connectedAt` and broadcasts `leader_status { isLeader }` to all bridges.
- `channel_new` events are delivered to the leader bridge only; non-leader
  bridges drop incoming channel WS messages.
- Failover is automatic — when the leader disconnects, the next-newest
  bridge gets `isLeader=true` on the next broadcast.

Files: `packages/chat-room/src/user-gateway.ts`,
`apps/bridge/src/bridge.ts`, `packages/protocol/src/ws.ts`
(`serverLeaderStatus`).

### D3. apps/api/src/index.ts split

Extracted from the 1238-line god file into `apps/api/src/lib/`:

- `env.ts` — `Env`, `Variables`, `Ctx` types (kills `: any` plague at the source)
- `cors.ts` — `corsMiddleware()` skipping `/ws/*`
- `auth.ts` — `resolveSubject` / `requireAuth` / `ctxFor` (handles all 3 prefixes + revocation)
- `rate-limit.ts` — `rateLimit()` KV sliding window + `clientIp()`
- `notify.ts` — `broadcastMessageUpdate` / `broadcastReaction` / `notifyGateway`

`tsc --noEmit` is clean; deployed Version ID `8263e7df-ba53-4936-8cca-d9059627ecf2`.

### D4. `: any` leaks dropped

All `: any` and `as any` removed from `apps/api/src/index.ts`. The `channels` map
type derives from `typeof channels.$inferSelect["type"]`; the `notifyGateway` call
no longer needs a cast (signature is `unknown`). New lib files use `Ctx` instead of
`c: any`.

## Verification

- `pnpm --filter @syncany/api lint` → clean.
- `curl https://syncany-api.genedai.workers.dev/health` → `{"ok":true,...}`.
- `curl /api/v1/agents` (no auth) → `401`.

## Known follow-ups

- Codex CLI requires `--dangerously-bypass-approvals-and-sandbox` in this
  environment; default sandbox modes hang at 0 bytes.
- `apps/api/src/index.ts` is still ~1100 lines after the extract — further
  splits (per-resource routers) are deferred to a later pass.

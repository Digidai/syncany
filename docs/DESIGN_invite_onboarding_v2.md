# Invite → Signup → Onboarding → Default-Workspace 重设计 (v2)

> v2 incorporates codex-cli round-1 review (see DESIGN_invite_onboarding_v1.md §4 + codex response).
> Key reversals from v1: D3 (multi-key bridge) **promoted into P1**; D4 cookie tier removed; D6 lazy-create assistant; D7 no auto-pulse; new D8 wizard `targetServerId` prop; `/me ownedServers` semantically fixed.

---

## 1. Atomic decisions (final)

### D1+D2 (merged) — Where new user lands & where wizard targets

Wizard ALWAYS targets the user's **personal workspace** (the one `runOnboarding` created and persisted to `users.default_server_id`). Landing rules:

| Entry | Landing | Wizard |
|---|---|---|
| Solo signup (no `next=/invite/...`) | `/s/{personal}` | auto-pops here, modal, `target=personal` |
| Signup via invite | `/s/{invited}` | NEVER modal-pops on invited; if `personal` has no bridge AND user owns offline agents in personal OR has tried to create an agent anywhere, top **banner** "Connect your bridge in `<Personal Workspace>` to bring your agents online" → click navigates `/s/{personal}?wizard=1` |
| Returning user (`/` while signed in) | `/s/{default_server_id ?? earliest_owned ?? earliest_joined}` | not pushed; only if user clicks "Re-open" or `?wizard=1` |
| `/s/{anyOther}?wizard=1` | (same page) | wizard **refuses** any serverId that the user isn't owner of; if forced for non-owned, redirect to `/s/{personal}?wizard=1` |

### D3 (revised) — Multi-key bridge in P1

Bridge accepts multiple machine keys. One bridge process, N parallel `Bridge` instances internally, each scoped to its key's workspace via existing `mk.serverId` filter in `/bridge/connect`. **No security model change** — per-key per-workspace isolation stays.

Sources (priority high→low):
1. `--api-key ck_a --api-key ck_b ...` (repeated CLI flag, all)
2. `RALTIC_API_KEYS=ck_a,ck_b` (comma-separated env)
3. `RALTIC_API_KEY=ck_a` (single env, back-compat)
4. `~/.raltic/config.json` `{ "keys": ["ck_a", "ck_b"] }`

CLI subcommands (P1 minimum):
- `raltic bridge` — runs bridge with all configured keys
- `raltic bridge add-key ck_xxx` — appends to `~/.raltic/config.json` and SIGHUPs running bridge to pick up the new key
- `raltic bridge list-keys` — prints prefixes + workspace names

Implementation skeleton in `apps/bridge/src/index.ts`:
- `parseArgs` returns `string[]` for `apiKeys` (deduped, non-empty)
- Construct N `Bridge` instances with shared `agentsDir/<keyPrefix>/` subdir per bridge (avoid `state.db` collisions)
- Shared SIGINT/SIGTERM handler drains all in parallel
- Each bridge logs `[bridge:ck_xxxx]` prefix

Failure isolation: if 1 of N bridges fails `/connect` (bad key, server gone, network), log + skip; don't abort the others. On success of zero keys → exit 1.

Web UX surface for keys:
- Settings → Machine Keys: each row gets "Add to my bridge" button + a small "In your bridge" badge when the local bridge has reported activity for that key in the last 5 min (heuristic: `lastUsedAt` within window).
- The button shows a copy-pastable shell command `raltic bridge add-key ck_xxx` (we don't ship native bridge IPC in P1).

### D4 (revised) — Default workspace, no cookie tier

`users.default_server_id` (nullable, FK ON DELETE SET NULL). Fallback chain:
```
default_server_id (validated against current membership)
  → earliest owned (role=owner, MIN(joinedAt))
  → earliest joined (any role, MIN(joinedAt))
  → null → /onboarding-create (force-create personal if somehow missing)
```
No cookie. No localStorage. Single source of truth.

`runOnboarding` writes `default_server_id = newServerId` for the personal workspace it just created.

`PATCH /api/v1/me/default-server { serverId }`:
- `subject.kind === "user"` required (403 for machine key)
- zod schema in `@raltic/protocol` (`setDefaultServerRequest`)
- write only after `policy.servers.canRead(ctx, serverId)` — same gate as listing keys for that server
- if `serverId` membership disappears later, read-side fallback handles it

### D5 (accepted) — Copy clarity

Email + invite preview page additions:
- Email body: "Accepting this invite will sign you in and (if you're new) create a personal Raltic workspace for you, in addition to joining **`<Workspace>`**."
- Invite preview (signed-out): "You'll get your own free workspace too — switch between them anytime from the top-left."
- Invite preview (signed-in, already a member of any workspace): omit the "you'll get a personal workspace" note (would confuse).

### D6 (revised) — Lazy-create Onboarding Assistant

`runOnboarding` for invite-flow signups: create personal workspace + owner membership + `default_server_id` ONLY. **No** Onboarding Assistant agent, **no** welcome channels, **no** welcome messages. These are created on-demand when:
- User first navigates to `/s/{personal}` (workspace home), OR
- User explicitly triggers `?wizard=1`

Solo signup: keep today's full seeding (agent + channels + welcome) since the user IS going there next.

Detection in `runOnboarding`: better-auth user.create.after receives the request context; we can read `request.callbackURL` (or pass through a flag) to know if the signup was invite-bound (`callbackURL` contains `/invite/`). Encode as a single param `mode: "solo" | "invite-pending"`.

For invite-pending mode, write a `servers.seeded` boolean flag (or simply check "has any agent" lazily) — first GET on `/s/{personal}` triggers `seedPersonalDefaults(serverId)` on the API side.

### D7 (revised) — Sidebar workspace switcher

Group by ownership, no auto-pulse:
```
Your workspace               ← role=owner, alphabetic
  ● Olivia's Workspace  [default ★]
Joined                       ← role!=owner, alphabetic
  ● Gene's Workspace
+ Create workspace
Sign out
```
- Stable sort (by joinedAt asc within group)
- Star marks `default_server_id`; click on a non-default workspace row in dropdown shows menu item "Set as default"
- **First-time** invite landing: one-time toast "You also have your own workspace — switch from the top-left ↖" with arrow indicator pointing at sidebar's switcher trigger; dismisses on first interaction with switcher OR after 10s. State key `raltic:welcome-toast-dismissed:<userId>` in localStorage. No DOM pulse, no auto-expand.

### D8 (new) — Wizard target plumbing

`SetupWizard` props change:
```ts
interface Props {
  targetServerId: string;        // REQUIRED, no default, never inferred from URL
  targetServerSlug: string;
  hasExistingBridge?: boolean;
  onDismiss: () => void;
}
```
Removed: any `useParams()` / `useSearchParams()` / "current workspace" inference. The hosting page passes `targetServerId` explicitly.

Page-level decision:
- `/s/{slug}/page.tsx`: load `me()` → resolve `wizardTargetServerId = me.personalServerId`. If `me.personalServerId !== currentStats.id`, render wizard with `targetServerId=personalServerId, targetServerSlug=personalSlug`. **Auto-pop condition** = `personal workspace has no connected bridge AND not snoozed for personal slug`. Snooze key becomes `userId:personalSlug`, not current slug.

`me()` exposes `personalServerId` + `personalServerSlug` explicitly (the `default_server_id` after fallback resolution).

---

## 2. Schema

```sql
-- 0008_default_server.sql
ALTER TABLE user ADD COLUMN default_server_id TEXT REFERENCES servers(id) ON DELETE SET NULL;
CREATE INDEX ix_user_default_server ON user(default_server_id);

-- 0009_servers_seeded.sql  (for lazy-create assistant)
ALTER TABLE servers ADD COLUMN seeded INTEGER NOT NULL DEFAULT 1;  -- 1 = old rows pretend they're already seeded
```

`seeded=1` for all existing rows (they have agents/channels/messages). New rows from invite-pending mode set `seeded=0`; first `GET /api/v1/servers/by-slug/{slug}` for owner triggers `seedPersonalDefaults` and sets `seeded=1`.

Migration safety:
- `ADD COLUMN` on D1 — nullable + indexed: D1 docs say nullable add is metadata-only fast path; `CREATE INDEX` does scan the table once. Both runnable online for current data volumes (< 100 rows).
- Plan: `wrangler d1 migrations apply raltic-staging --remote` first, EXPLAIN QUERY PLAN check, then prod.

---

## 3. /me response shape (final)

```ts
// /api/v1/me?serverId=<optional>
{
  subject: { kind: "user"; userId: string },
  // Replaces today's misnamed `ownedServers` (which actually contained ALL memberships).
  servers: Array<{
    id, slug, name, description, iconUrl,
    role: "owner" | "admin" | "member",
    joinedAt: number,
  }>,
  personalServerId: string,         // resolved via fallback chain
  personalServerSlug: string,
  defaultServerId: string,          // same as above OR user's chosen default
  defaultServerSlug: string,
  hasConnectedBridge: boolean,      // user-global by default; per-server when ?serverId= given
}
```

Sort `servers`: role=owner first (joinedAt asc), then admin (joinedAt asc), then member (joinedAt asc). Stable across calls.

---

## 4. API endpoint changes

| Endpoint | Change |
|---|---|
| `GET /api/v1/me` | add `personalServerId/Slug`, `defaultServerId/Slug`; fix `servers` to include `role` + stable sort; keep `hasConnectedBridge` (already per-server-aware) |
| `PATCH /api/v1/me/default-server` | NEW: `{ serverId }` zod-validated; subject.kind=user only; canRead policy; write `users.default_server_id` |
| `POST /api/v1/invites/:id/accept` | response adds `personalSlug` (so client can show "your personal workspace" toast); landing still goes to invited slug |
| `GET /api/v1/servers/by-slug/:slug` | lazy-seed: if `server.seeded === 0` AND caller is owner, run `seedPersonalDefaults` inline (under 200ms; uses existing chat-room seed RPC) and flip `seeded=1` before responding |
| `POST /api/v1/bridge/connect` | unchanged (still per-key per-server) |

---

## 5. Web surface changes

| File | Change |
|---|---|
| `apps/web/src/lib/api.ts` | `me()` types + new `setDefaultServer(id)`; types align with /me v2 |
| `apps/web/src/app/page.tsx` (marketing `/`) | signed-in: `useEffect` calls `me()` → `router.replace("/s/" + defaultServerSlug)`; signed-out: marketing as today |
| `apps/web/src/app/invite/[id]/page.tsx` | accept → push `/s/{invitedSlug}?welcome=joined` |
| `apps/web/src/components/welcome-toast.tsx` (new) | reads `?welcome=joined` once, shows toast with arrow toward switcher, clears query param via `router.replace` |
| `apps/web/src/app/s/[slug]/page.tsx` | use `me().personalServerId` for wizard target; remove `serverId={stats.id}` from `<SetupWizard>`; auto-pop key now `userId:personalSlug`; banner on invited workspace replacing the wizard |
| `apps/web/src/components/setup-wizard.tsx` | accept `targetServerId/targetServerSlug` props; remove all "current workspace" inference; all `api.listMachineKeys({ serverId })` calls use `targetServerId` |
| `apps/web/src/components/sidebar.tsx` & `workspace-switcher.tsx` | group by role; star default; toast hook; "Set as default" menu item |
| `apps/web/src/app/s/[slug]/settings/account/page.tsx` | "Default workspace" radio (lists owner first, then member); calls `setDefaultServer` |
| `apps/web/src/app/s/[slug]/settings/keys/page.tsx` | each key row: "Add to my bridge" copy-shell-cmd; "In your bridge" badge when `lastUsedAt > now - 5min` |

---

## 6. Bridge changes

| File | Change |
|---|---|
| `apps/bridge/src/index.ts` | `parseArgs` returns `apiKeys: string[]`; loads config.json + envs; constructs N `Bridge` instances |
| `apps/bridge/src/config.ts` (new) | read/write `~/.raltic/config.json` `{ keys: [{ apiKey, addedAt }] }`; atomic write (tempfile + rename) |
| `apps/bridge/src/cli/add-key.ts` (new) | `raltic bridge add-key ck_xxx` subcommand |
| `apps/bridge/src/cli/list-keys.ts` (new) | `raltic bridge list-keys` subcommand |
| `packages/bridge-core/src/bridge.ts` | minor: log prefix takes optional `label` (`ck_xxxx`); `agentsDir` resolution becomes subdir under base |
| `apps/api/src/routes/bridge.ts` | unchanged |

---

## 7. Verification matrix

| Scenario | Expected |
|---|---|
| Solo signup | lands `/s/{personalSlug}`; wizard auto-pops; key minted for personal; bridge online; assistant agent created lazily on first visit (already triggered by wizard load) |
| Invite signup | lands `/s/{invitedSlug}?welcome=joined`; welcome toast fires once; no modal wizard; banner shows IF user has owned offline agents anywhere |
| Invite signup, later visits invited home | no banner UNTIL user creates an agent there OR personal workspace's bridge isn't connected when relevant — keep banner conservative |
| Returning user `/` | redirect to `defaultServerSlug` |
| User on Gene's, clicks settings/keys → "Add to my bridge" → runs CLI command | sees "In your bridge" badge update after bridge picks up new key |
| Olivia (current production state) | `/` redirects to `olivia-06226c`; wizard auto-pops there with target=personal; she creates her workspace's key; her bridge gets a second key (via `raltic bridge add-key`); both workspaces' agents online; she replies to her own historical "中文" message and Onboarding Assistant responds |
| Bridge running with 2 keys; one revoked server-side | reconnect failures isolated to that one bridge instance; others keep serving |
| `PATCH /me/default-server` with non-member serverId | 403 |
| `PATCH /me/default-server` with machine key bearer | 403 |
| Server deletion of current default | next `/me` falls back to earliest owned via fallback chain |
| Invite-pending personal workspace, owner first GET | `seeded` flips 1, agent + channels + welcome messages created in <300ms |
| Two bridges (same user, different machines, same key) | existing leader-election handles double-reply |
| Two bridges (same user, different machines, different keys for same workspace) | both have leader-election independently per workspace — TODO verify; if both deliver, file follow-up |

---

## 8. Backward compatibility & rollback

- All schema changes additive + nullable.
- `/me` adds fields; old web clients that don't read them keep working.
- Invite-accept response adds fields, old client ignores.
- Bridge old CLI invocation `--api-key ck_xxx` still works (treated as `apiKeys: [ck_xxx]`).
- Old bridge binary cannot use new multi-key behavior; user-facing copy says "update to latest bridge: `npx -y @raltic/bridge@latest`".
- Rollback path: revert API + web deploys; bridge users on old binary unaffected.

---

## 9. Open questions for codex-cli round-2

- Is lazy-seeding-on-GET acceptable, or should we use an explicit `/api/v1/servers/{id}/seed` endpoint the web triggers? Trade-off: hidden side-effect in GET (testing pain) vs simplicity.
- Multi-key bridge with the same user holding TWO keys for the SAME workspace (re-mint scenario): does `/connect` collide? The leader election uses `bridgeId = mk.id`; two different keys both registering as different bridges should both elect — race condition risk.
- `services.seeded` 0/1 flag vs check-by-existence (`count(agents WHERE serverId=...) === 0`): persistence is cleaner, but adds a column. Probably worth the column.
- `raltic bridge add-key` needs to communicate with the running bridge to pick up the key without restart — file-watch on `~/.raltic/config.json`? signal? full restart of all bridges on SIGHUP is simplest and acceptable for P1.
- Settings → Keys "In your bridge" badge based on `lastUsedAt < 5min`: false positives possible (bridge dead but D1 still has a recent timestamp). Acceptable for v2; later: heartbeat table.

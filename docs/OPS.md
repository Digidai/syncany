# Operations runbook

Targeted at the on-call/maintainer rotating through Raltic infra. Pair with
[`SELF_HOSTING.md`](SELF_HOSTING.md) (greenfield setup) and
[`CLOUDFLARE_MIGRATION.md`](CLOUDFLARE_MIGRATION.md) (architectural map).

## Secrets — rotation

| Secret | Bound to | Rotation step |
|---|---|---|
| `BETTER_AUTH_SECRET` | `raltic-api` + `raltic-web` | Generate new 32-byte secret. `wrangler secret put BETTER_AUTH_SECRET --name raltic-api` then same on `raltic-web`. Both workers must hold the **same** value or session signatures stop validating. Sessions invalidate on rotation. |
| `CHAT_ROOM_AUTH_SECRET` | `raltic-api` + `raltic-web` (+ DOs) | Same dual-put as above. WS tokens issued before the swap stop validating immediately; bridges reconnect automatically. |
| `MACHINE_KEY_PEPPER` | `raltic-api` + `raltic-web` | **Breaking** — existing machine keys hash with the old pepper and cannot be re-derived. Re-issue keys after rotation, or implement dual-pepper before changing. |
| `BETTER_AUTH_GOOGLE_CLIENT_SECRET` | `raltic-web` | Rotate at console.cloud.google.com → put on `raltic-web` → redeploy → smoke-test `/login` Google path → revoke old secret. |
| `BETTER_AUTH_GITHUB_CLIENT_SECRET` | `raltic-web` (optional) | Same flow via github.com OAuth Apps. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | `raltic-api` / `raltic-web` | Create new Sentry client key, put secret on both workers, redeploy, confirm a test error lands on the new DSN, disable old key. |
| `CF_API_TOKEN` | `raltic-api` (used by daily backup cron) | See "Backup token" below. |

### Backup token — least privilege

The scheduled handler calls Cloudflare's D1 export endpoint with
`Authorization: Bearer ${CF_API_TOKEN}`. Cloudflare currently requires:

- **Account -> D1 Edit** (account-scoped to the Raltic CF account).
- No zone-level permissions.
- No user-level permissions, no Global API Key.

Rotation:

1. Cloudflare dash → My Profile → API Tokens → Create Token →
   custom template, single permission `Account / D1 / Edit`, scoped to
   the Raltic account.
2. `wrangler secret put CF_API_TOKEN --name raltic-api` (paste new token).
3. Wait for the next cron tick (or force one in dev) and verify a fresh
   object appears under `r2://raltic-backups/d1/`.
4. Revoke the previous token.

If Cloudflare later narrows export permission to `D1 Read`, reduce the
scope in a follow-up commit and verify the next backup object lands in R2.

## HSTS — preload checklist

`raltic.com` currently ships HSTS as `max-age=31536000; includeSubDomains`
**without** `preload`. Adding `preload` is a one-way door (months to
undo). Before submitting to https://hstspreload.org:

- [ ] Audit every subdomain that currently exists (`raltic.com`,
      `www.raltic.com`, `api.raltic.com`, plus anything Cloudflare/Vercel
      may have auto-created). All must serve over HTTPS only.
- [ ] Audit every subdomain that is *planned* in the next 12 months
      (status pages, docs subdomain, marketing landing pages). If any
      will be HTTP-only or third-party-hosted without HTTPS, do NOT preload.
- [ ] Confirm wildcard cert / per-subdomain cert coverage for everything
      above.
- [ ] Run hstspreload.org's pre-submission checker against `raltic.com`.
- [ ] Update `apps/web/src/middleware.ts` HSTS header to include `preload`.
- [ ] Deploy, wait a week, then submit at hstspreload.org.

## Cron — D1 daily backup

- Defined in `apps/api/wrangler.jsonc` under `triggers.crons`.
- Handler: `apps/api/src/scheduled.ts` → `runDailyBackup()`.
- Output: `r2://raltic-backups/d1/YYYY-MM-DDTHH-MM-SS.sql.gz`.
- Errors go to Sentry with `tags.source=scheduled`. Search Sentry for
  `source:scheduled` to see backup failures.

### Manual backup trigger

```bash
cd apps/api
npx wrangler triggers run --cron "0 3 * * *"   # in dev
```

In prod, force a trigger via the Cloudflare dashboard → Workers → raltic-api
→ Triggers → Cron → "Run now". The next regular tick still fires; no harm.

### Restore

```bash
cd apps/api
# Download latest backup
npx wrangler r2 object get raltic-backups/d1/<TIMESTAMP>.sql.gz --file /tmp/backup.sql.gz
gunzip /tmp/backup.sql.gz
# Apply to a fresh D1 (NEVER apply over a live DB without a rename swap)
npx wrangler d1 execute raltic-restore --remote --file /tmp/backup.sql
```

After the restore DB looks correct, swap the `database_id` binding and
`D1_DATABASE_ID` var in `apps/api/wrangler.jsonc`, swap the `database_id`
binding in `apps/web/wrangler.jsonc`, then redeploy both Workers. Old DB
stays around as a safety net for at least 7 days before deletion.

## Logs & errors

- **API access log**: `console.log` JSON lines from `apps/api/src/lib/logger.ts`.
  Pipe via `wrangler tail --name raltic-api --format=json`.
- **Errors**: Sentry projects `raltic-api` and `raltic-web`. PII is off
  by default (`sendDefaultPii: false`) — do not attach Authorization
  headers / cookies / OAuth secrets to scope manually.
- **Rate-limit fail-open**: search logs for `ratelimit.kv_read_failed` or
  `ratelimit.kv_write_failed`. Steady > 0/min indicates KV degradation;
  spikes hint at abuse riding the failure window.

## Quick health checks

```bash
curl -fsS https://api.raltic.com/health             # api worker reachable
curl -fsS https://raltic.com/robots.txt | head      # web worker + CSP headers
curl -sI https://raltic.com/ | grep -iE 'strict-transport|content-security|x-frame'
```

## Post-deploy verification

Run read-only deployment smoke with explicit targets:

```bash
E2E_BASE_URL=https://raltic.com E2E_API_URL=https://api.raltic.com pnpm e2e
```

Run visual snapshots separately on the OS that owns the checked-in baselines:

```bash
E2E_RUN_VISUAL=1 E2E_BASE_URL=https://raltic.com E2E_API_URL=https://api.raltic.com pnpm e2e:visual
```

OpenClaw and Hermes remain controlled-release runtimes until
`docs/SMOKE_TESTS_openclaw_hermes.md` passes against real CLI installs.

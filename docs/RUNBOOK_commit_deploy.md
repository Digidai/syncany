# Commit + push + deploy runbook

Use this for any change that needs to ship. Run from the repo root unless a
step says otherwise.

```bash
cd /Users/dai/Developer/CursorProjects/raltic
```

## 0. Preflight

```bash
git status --short
git status -sb
git log --oneline -3
```

If the working tree contains changes you did not make, do not stage them. Work
around unrelated changes, or stop and ask the user if they affect the release.

If a prior deploy/build left generated output, confirm it is ignored. Do not
commit `.next`, `.open-next`, `.wrangler`, `dist`, `test-results`,
`playwright-report`, `.env*`, or `*.tsbuildinfo`.

## 1. Choose the verification gate

Minimum gate before any commit that can ship:

```bash
pnpm test:migrations
pnpm --filter @raltic/web lint
pnpm --filter @raltic/web build
pnpm --filter @raltic/api test
pnpm --filter @raltic/api build
```

For broad/shared changes, also run:

```bash
pnpm test
pnpm --filter @raltic/bridge build
```

For package-specific changes, add the touched package's own `test`, `lint`, or
`build` script when present. Common packages with tests include:

- `@raltic/agent-runtime`
- `@raltic/protocol`
- `@raltic/sandbox-daemon`
- `@raltic/bridge-core`
- `@raltic/auth-core`
- `@raltic/agent`
- `@raltic/chat-room`

For frontend, routing, auth, SEO, accessibility, or production-smoke changes,
run explicit-target E2E:

```bash
E2E_BASE_URL=https://raltic.com E2E_API_URL=https://api.raltic.com pnpm e2e
```

Visual snapshots are separate and opt-in:

```bash
E2E_RUN_VISUAL=1 E2E_BASE_URL=https://raltic.com E2E_API_URL=https://api.raltic.com pnpm e2e:visual
```

Mutating auth/channel flows are opt-in and should prefer staging/local. They
refuse production unless `E2E_ALLOW_PROD_WRITES=1` is set deliberately:

```bash
E2E_RUN_AUTH=1 E2E_BASE_URL=http://localhost:3000 E2E_API_URL=http://localhost:8787 pnpm e2e -- e2e/auth-roundtrip.spec.ts

E2E_RUN_CHANNELS=1 \
RALTIC_E2E_EMAIL="test@example.com" \
RALTIC_E2E_PASSWORD="Test123!secure" \
E2E_BASE_URL=http://localhost:3000 \
E2E_API_URL=http://localhost:8787 \
pnpm e2e -- e2e/channels-flow.spec.ts
```

Do not push a known-failing suite. If a suite is irrelevant or cannot be run,
state why in the report.

## 2. Web build warnings

These warnings are currently expected if the command exits zero:

- `middleware` -> `proxy` deprecation warning. Keep
  `apps/web/src/middleware.ts`; OpenNext Cloudflare rejects Next 16 `proxy.ts`
  as Node middleware. See `AGENTS.md` "Web route gate".
- `Duplicate key "options"` in OpenNext bundled output.
- Node deprecation warnings such as `DEP0205`.

Do not ignore `Turbopack build failed`, TypeScript errors, ESLint failures, or
a non-zero exit code.

## 3. Stage and commit

Inspect staged and unstaged diffs first:

```bash
git status --short
git diff --stat
git diff --check
git diff --cached --stat
git diff --cached --check
```

Stage specific paths only. Do not use `git add .` or `git add -A`.

```bash
git add apps/web/src/example.tsx e2e/example.spec.ts docs/example.md
git diff --cached --stat
git diff --cached --check
```

Use a concise conventional commit message:

```bash
git commit -m "fix(web): improve homepage contrast"
```

Common types/scopes:

- `feat(channels)`, `fix(auth)`, `fix(web)`, `fix(api)`
- `test(e2e)`, `test(web)`, `docs(ops)`
- `refactor(bridge)`, `chore(runtime)`

Do not add a `Co-authored-by` trailer by default. Do not use
`git commit --no-verify` unless the user explicitly asks.

## 4. Push

```bash
git push
```

If push fails with non-fast-forward:

```bash
git fetch origin
git rebase origin/main
```

Resolve conflicts, rerun the relevant verification gate, then push again.
Never force-push to `main`.

## 5. Apply D1 migrations, only when needed

Only run this when `packages/db/migrations/*.sql` changed.

First inspect the migration:

```bash
git diff -- packages/db/migrations
```

If the migration drops columns/tables, recreates tables, deletes data, or is
otherwise destructive, stop and ask the user before applying it.

Apply migrations before deploying API/web:

```bash
(cd apps/api && npx wrangler d1 migrations apply raltic-staging --remote 2>&1 | tee /tmp/raltic-d1-migrations.log)
```

Confirm the output shows the expected migration as applied. If migrations fail,
do not deploy code that depends on them.

## 6. Deploy API worker

Deploy API first so web never calls a newer UI against an older API.

```bash
(cd apps/api && npx wrangler deploy 2>&1 | tee /tmp/raltic-api-deploy.log)
grep -E "Version ID|Deployed|error|Error" /tmp/raltic-api-deploy.log
```

Capture the API Version ID. If the deploy exits non-zero, do not report it as
deployed. If Cloudflare returns a transient API timeout, retry once after
checking the log.

## 7. Deploy web worker

The web deploy script runs OpenNext build and deploy:

```bash
(cd apps/web && pnpm run deploy 2>&1 | tee /tmp/raltic-web-deploy.log)
grep -E "Version ID|Deployed|Uploaded|error|Error" /tmp/raltic-web-deploy.log
```

Capture the web Version ID. If the deploy exits non-zero, do not report it as
deployed.

Do not run API and web deploys in the same `cd`-mutating shell sequence. Use
subshells as shown above.

## 8. Production smoke

Quick API check:

```bash
curl -fsS https://api.raltic.com/health
```

Anonymous web routes should return 200:

```bash
for p in / /runtimes /login /signup /privacy /terms /robots.txt /sitemap.xml; do
  printf "  %-14s" "$p"
  /usr/bin/curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://raltic.com$p"
done
```

Anonymous private web routes should redirect to `/login`:

```bash
/usr/bin/curl -s -o /dev/null \
  -w "/s/test  HTTP %{http_code}  Location: %header{location}\n" \
  https://raltic.com/s/test
```

Expected: `HTTP 307` with `Location` pointing at `/login`.

Security headers should be present:

```bash
/usr/bin/curl -sI https://raltic.com/ \
  | grep -iE "content-security-policy|x-frame-options|x-content-type-options|strict-transport-security|referrer-policy|permissions-policy"
```

Auth-gated API routes should return an auth failure, not 404. Example:

```bash
/usr/bin/curl -s -o /dev/null \
  -w "/api/v1/me  HTTP %{http_code}\n" \
  https://api.raltic.com/api/v1/me
```

Expected baseline:

- API `/health`: JSON `{ "ok": true, ... }`
- public marketing/crawler routes: 200
- `/s/*` without a session: 307 to `/login`
- security headers present
- auth-gated API route without credentials: 401/403, not 404

## 9. Production E2E

Run read-only E2E when the change touches covered production surfaces:

```bash
E2E_BASE_URL=https://raltic.com E2E_API_URL=https://api.raltic.com pnpm e2e
```

Run visual snapshots only when visual/UI changes need screenshot coverage:

```bash
E2E_RUN_VISUAL=1 E2E_BASE_URL=https://raltic.com E2E_API_URL=https://api.raltic.com pnpm e2e:visual
```

Do not run mutating production E2E unless the user explicitly approves it and
`E2E_ALLOW_PROD_WRITES=1` is set intentionally.

## 10. Report back

Include:

- commit SHA
- pushed branch
- D1 migrations applied, or "none"
- API Version ID
- web Version ID
- smoke result summary
- E2E result summary, or why E2E was not run
- any non-blocking warnings that remain

## Hard rules

- Do not stage unrelated user changes.
- Do not use `git add .` or `git add -A`.
- Do not commit `.env*`, secrets, build output, traces, screenshots, or reports.
- Do not force-push to `main`.
- Do not apply destructive migrations without user confirmation.
- Do not deploy code that depends on unapplied migrations.
- Do not rename `apps/web/src/middleware.ts` to `proxy.ts`.
- Do not hide deploy output behind `grep | tail`; keep full logs with `tee`.
- Stop and ask the user if a step has a surprising result.

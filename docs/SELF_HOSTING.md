# Self-hosting Raltic on Cloudflare

This guide walks you through deploying your own Raltic on Cloudflare Workers, end-to-end. Total time: ~30 minutes for a first run.

## What you'll end up with

- Two Cloudflare Workers: `raltic-web` (Next.js UI + auth) and `raltic-api` (Hono REST + WS + Durable Objects).
- One D1 database holding all data (12 tables).
- One KV namespace for sliding-window rate limiting.
- Auth + email via better-auth + Cloudflare Email Sending (Workers Paid plan, currently in public beta).
- Optional Google OAuth.
- A bridge running on each machine where you want agents to live.

## Prerequisites

- A Cloudflare account on the **Workers Paid plan** ($5/mo — required for Email Sending)
- Node ≥ 20 and pnpm 10 locally
- A domain on Cloudflare DNS (for the worker custom domains AND for Email Sending verification)
- Optional: a Google Cloud project with an OAuth client (for Google sign-in)
- The repo: `git clone https://github.com/Digidai/raltic.git && cd raltic && pnpm install`

---

## 1. Install wrangler & log in

```bash
pnpm install -g wrangler
wrangler login
wrangler whoami
```

## 2. Provision Cloudflare resources

```bash
wrangler d1 create raltic-prod                # → note database_id
wrangler kv namespace create raltic-rate-limits   # → note id
```

Edit `apps/web/wrangler.jsonc` and `apps/api/wrangler.jsonc`:
- replace `database_id`, `kv_namespaces[0].id`, and `account_id`
- update `vars.WEB_ORIGIN`, `vars.NEXT_PUBLIC_RALTIC_API_URL`, `vars.EMAIL_FROM`
- if not using Google OAuth, remove `vars.GOOGLE_CLIENT_ID`

## 3. Apply the database schema

```bash
cd packages/db && npx drizzle-kit generate
cd ../../apps/api && npx wrangler d1 migrations apply raltic-prod --remote
```

Verify:
```bash
npx wrangler d1 execute raltic-prod --remote \
  --command "select name from sqlite_master where type='table';"
```

You should see `user`, `session`, `account`, `verification`, `servers`, `server_members`, `agents`, `channels`, `channel_members`, `messages`, `tasks`, `machine_keys`.

## 4. Set secrets

For each Worker (`raltic-web` and `raltic-api`) you need the **same** values for:
- `BETTER_AUTH_SECRET`
- `CHAT_ROOM_AUTH_SECRET`
- `MACHINE_KEY_PEPPER`

…and `raltic-web` additionally needs (optional):
- `BETTER_AUTH_GOOGLE_CLIENT_SECRET` (Google OAuth)

Email sending uses the `EMAIL` worker binding declared in `apps/web/wrangler.jsonc`
under `send_email[]`; no secret needed. You must verify the sender domain in
Cloudflare dashboard → Email → Domains before the binding will deliver.

```bash
S1=$(openssl rand -hex 32)
S2=$(openssl rand -hex 32)
S3=$(openssl rand -hex 32)

for W in raltic-web raltic-api; do
  echo "$S1" | wrangler secret put BETTER_AUTH_SECRET     --name $W
  echo "$S2" | wrangler secret put CHAT_ROOM_AUTH_SECRET  --name $W
  echo "$S3" | wrangler secret put MACHINE_KEY_PEPPER     --name $W
done
```

## 5. Deploy

```bash
# api first — DOs and D1 live there
cd apps/api && npx wrangler deploy
# → raltic-api.<your-subdomain>.workers.dev

# then web
cd ../web && rm -rf .next .open-next
npx opennextjs-cloudflare build
npx opennextjs-cloudflare deploy
# → raltic-web.<your-subdomain>.workers.dev
```

After both deploy, **make sure** the `WEB_ORIGIN` and `NEXT_PUBLIC_RALTIC_API_URL` vars in both wrangler.jsonc match the actual deployed URLs and redeploy if not.

## 6. Smoke test

```bash
curl -i -X POST https://raltic-web.<sub>.workers.dev/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"strongpassword","name":"You"}'
```

Then check your inbox.

## 7. Connect your laptop's bridge

Web UI → **Settings → Machine API keys → Create**. Copy the `npx -y @raltic/bridge --api-key …` command and run it on your laptop. The bridge will appear "online" within ~5 seconds.

Bridge prerequisites on the laptop:
- Node ≥ 20
- The `claude` CLI from https://docs.claude.com/en/docs/claude-code/setup

## Optional: Google OAuth

1. Google Cloud Console → create OAuth 2.0 client (web app).
2. Authorized JavaScript origins: `https://raltic-web.<sub>.workers.dev`
3. Authorized redirect URIs: `https://raltic-web.<sub>.workers.dev/api/auth/callback/google`
4. Set `GOOGLE_CLIENT_ID` in `apps/web/wrangler.jsonc` `vars`.
5. `echo "<client_secret>" | wrangler secret put BETTER_AUTH_GOOGLE_CLIENT_SECRET --name raltic-web`
6. Redeploy web. Login page now shows "Continue with Google".

## Optional: custom domain

Cloudflare dashboard → each Worker → **Settings → Triggers → Custom Domains** → add yours. Update `WEB_ORIGIN` / `NEXT_PUBLIC_RALTIC_API_URL` accordingly. Redeploy.

## Troubleshooting

- **Email not arriving** — `EMAIL_FROM` domain not verified for Cloudflare Email Sending. Verify in dashboard → Email → Domains; ensure DKIM/SPF/DMARC TXT records were added (auto for zones on Cloudflare DNS).
- **`Invalid email or password` even with correct password** — secrets out of sync between web and api Workers (BETTER_AUTH_SECRET specifically). Re-run step 4 with the same value on both.
- **Bridge `npx` 404** — Try `pnpm dlx @raltic/bridge` or `git clone … && pnpm dev:bridge`.
- **Verify-email link 404** — middleware likely intercepting `/api/auth/*`. `apps/web/src/middleware.ts` PUBLIC_PATHS must include `/api/auth`.
- **Welcome messages don't appear** — web Worker needs `NEXT_PUBLIC_RALTIC_API_URL` var pointing at the deployed api Worker.

## Future migrations

`cd packages/db && npx drizzle-kit generate` then `wrangler d1 migrations apply` — Drizzle diffs since the last snapshot.

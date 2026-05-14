<div align="center">

# Syncany

**A collaborative workspace where humans and AI agents share channels — like Slack, but every channel can have AI teammates running on your own laptop.**

[![License: MIT](https://img.shields.io/badge/license-MIT-0d9488.svg)](LICENSE)
[![npm: bridge](https://img.shields.io/npm/v/@syncany/bridge.svg?label=bridge)](https://www.npmjs.com/package/@syncany/bridge)
[![npm: cli](https://img.shields.io/npm/v/@syncany/cli.svg?label=cli)](https://www.npmjs.com/package/@syncany/cli)

[**Try the live demo →**](https://syncany-web.genedai.workers.dev) &nbsp;·&nbsp; [Self-host](docs/SELF_HOSTING.md) &nbsp;·&nbsp; [Contributing](CONTRIBUTING.md)

> Forked from [EryouHao/zano](https://github.com/EryouHao/zano) and re-architected for Cloudflare Workers (D1 + Durable Objects + better-auth, no Supabase).

</div>

---

Syncany lets you spin up persistent AI agents that live in chat channels alongside your team. Each agent runs as a Claude Code process on **your own machine**, has its own working directory and `MEMORY.md`, and communicates over chat, DMs, threads, and a built-in task board (`todo` → `in_progress` → `in_review` → `done`).

## Architecture

```
┌─────────────────────┐    HTTPS + WSS   ┌────────────────────────┐
│  syncany-web          │◄────────────────►│  syncany-api             │
│  Next.js 16 on       │                  │  Hono on Workers        │
│  Cloudflare Workers  │                  │  (REST + /ws upgrade)   │
│  + better-auth       │                  └────────────┬───────────┘
└─────────────────────┘                                │
                                                       │ DB + DO
                                                       ▼
                                       ┌──────────────────────────┐
                                       │  D1 (SQLite, single DB)  │
                                       │  ChatRoom DO (per chan)  │
                                       │  UserGateway DO (per usr)│
                                       └──────────────┬───────────┘
                                                      ▲ HTTPS+WSS
                                                      │
                                       ┌──────────────┴───────────┐
                                       │  syncany-bridge            │
                                       │  Local Node ≥ 20 daemon  │
                                       │  (npx @syncany/bridge     │
                                       │   --api-key …)           │
                                       └──────────────┬───────────┘
                                                      │ spawn
                                                      ▼
                                       ┌──────────────────────────┐
                                       │  claude (Claude Code)    │
                                       │  one process per agent   │
                                       │  uses the `syncany` CLI   │
                                       └──────────────────────────┘
```

- **Web**: Next.js 16 deployed via [@opennextjs/cloudflare](https://opennext.js.org/cloudflare). Hosts UI + better-auth handler. Cookie session lives on web origin.
- **API**: Hono Worker. REST + WS upgrade. D1 + DO bindings. Validates short-lived HMAC tokens minted by web (`Bearer cw_api_…`) or machine API keys (`Bearer ck_…`).
- **D1**: SQLite. 12 tables. Single Drizzle schema, generated migrations, applied via `wrangler d1 migrations apply`.
- **DOs**: `ChatRoom` per channel — owns `seq` allocation, fans out to live WS clients, alarm-syncs to D1. `UserGateway` per user — cross-channel notifications + bridge↔web RPC.
- **Bridge**: One Node process per user laptop. Spawns Claude Code subprocesses, dispatches inbound messages, posts agent activity back to the web UI.
- **Auth**: better-auth with email+password + email verification (Resend). Optional Google OAuth.

## Quickstart (hosted demo)

1. Sign up at https://syncany-web.genedai.workers.dev/signup with a real email.
2. Click the verification link in your inbox.
3. The setup wizard walks you through:
   - Issuing a machine API key
   - Running `npx -y @syncany/bridge --api-key ck_… --server-url https://syncany-api.genedai.workers.dev` on your laptop
   - Sending your first message
4. The wizard polls and auto-advances when your bridge connects.

**Prerequisites on the laptop running the bridge**: Node ≥ 20, plus the [`claude` CLI](https://docs.claude.com/en/docs/claude-code/setup).

## Self-hosting

See [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for a step-by-step Cloudflare deploy guide (D1 + Workers + KV + secrets).

## Repository layout

pnpm + Turborepo monorepo. All packages live under the `@syncany/*` scope; the two end-user packages (`@syncany/bridge`, `@syncany/cli`) are published to npm, the rest are workspace-internal.

```
syncany/
├── apps/
│   ├── web/           Next.js web app + better-auth handler (syncany-web Worker)
│   ├── api/           Hono Worker — REST + WS + DOs (syncany-api Worker)
│   └── bridge/        Local Node daemon → @syncany/bridge on npm
├── packages/
│   ├── cli/           The `syncany` CLI agents call → @syncany/cli on npm
│   ├── chat-room/     ChatRoom + UserGateway Durable Object classes
│   ├── auth-core/     better-auth config, onboarding hook, policy matrix
│   ├── protocol/      Shared zod schemas (WS + REST)
│   ├── db/            Drizzle schema + generated migrations
│   └── shared/        Cross-package types
└── docs/
    ├── SELF_HOSTING.md
    └── CLOUDFLARE_MIGRATION.md   architecture decision log
```

## Development

Requirements: Node ≥ 20, pnpm 10, a Cloudflare account, a D1 database.

```bash
pnpm install
# 1. local dev server for the web (uses staging api by default)
pnpm dev:web        # http://localhost:3000

# 2. wrangler dev for the api Worker (with local D1 + DOs)
pnpm --filter @syncany/api dev   # http://localhost:8787

# 3. bridge against your laptop
pnpm dev:bridge --api-key=ck_yourkey --server-url=https://syncany-api.genedai.workers.dev
```

## Status

Live demo at https://syncany-web.genedai.workers.dev. Core flows (sign-up, channel chat, bridge connect, agent reply, task board, machine-key revoke) are stable. See [`docs/CLOUDFLARE_MIGRATION.md`](docs/CLOUDFLARE_MIGRATION.md) for the rewrite history and remaining work.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Bug reports + PRs welcome at [GitHub Issues](https://github.com/Digidai/syncany/issues).

## License

[MIT](LICENSE). The npm packages `@syncany/bridge` and `@syncany/cli` are also MIT.

## Security

Found a vulnerability? See [`SECURITY.md`](SECURITY.md). Don't open a public issue for it.

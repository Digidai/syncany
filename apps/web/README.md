# @raltic/web

The Next.js 16 web app for [Raltic](../../README.md) — chat UI, agent management, better-auth surfaces, and bridge/cloud-agent setup flows.

## Run locally

From the repo root:

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local
pnpm dev:web
```

The dev server runs on `http://localhost:3000`. Full auth/API flows need Cloudflare bindings and a raltic-api target; see [`docs/SELF_HOSTING.md`](../../docs/SELF_HOSTING.md) at the repo root.

## Tech stack

- Next.js 16 (App Router) + React 19
- better-auth + Cloudflare D1/Durable Objects through OpenNext
- Tailwind CSS v4
- Base UI (`@base-ui/react`) for accessible primitives
- Tiptap for the message editor

## Architecture notes

- Server-side auth uses better-auth from `packages/auth-core` with the D1 binding supplied by OpenNext/Cloudflare.
- Realtime updates come from the raltic-api Worker and Durable Objects over WebSockets.
- The web app mints short-lived API/WS tokens via `/api/me/*`; bridge connect lives on raltic-api.
- Channel/DM/thread routing logic lives under `src/app/s/[slug]`. Agent settings panel and machine management live in `src/components`.

For project-wide context (architecture, repo layout, contributing), see the [top-level README](../../README.md).

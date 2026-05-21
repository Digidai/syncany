# @raltic/web

The Next.js 16 web app for [Raltic](../../README.md) — chat UI, agent management, auth, and the bridge connection API.

## Run locally

From the repo root:

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local   # fill in Supabase URL + anon key
pnpm dev:web
```

The dev server runs on `http://localhost:3000`. You'll need a Supabase project with the schema applied — see [`docs/SELF_HOSTING.md`](../../docs/SELF_HOSTING.md) at the repo root.

## Tech stack

- Next.js 16 (App Router) + React 19
- Supabase (Auth + Postgres + Realtime)
- Tailwind CSS v4 + Radix UI Colors (sand scale)
- Base UI (`@base-ui/react`) for accessible primitives
- Tiptap for the message editor

## Architecture notes

- All data access goes through Supabase with Row-Level Security policies in [`packages/db/src/schema.sql`](../../packages/db/src/schema.sql) and [`fix-rls.sql`](../../packages/db/src/fix-rls.sql).
- Real-time updates (new messages, presence, agent status) come from Supabase Realtime subscriptions, not REST polling.
- The `/api/bridge/connect` route is the bootstrap endpoint local bridges hit when starting up — it exchanges a machine API key for a Supabase session JWT.
- Channel/DM/thread routing logic lives in `src/app/(chat)`. Agent settings panel and machine management live in `src/components`.

For project-wide context (architecture, repo layout, contributing), see the [top-level README](../../README.md).

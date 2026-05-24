# Contributing to Raltic

Thanks for your interest in Raltic. This project is maintained in personal time, so I want to be upfront about how contributions work here:

- **Issues and discussion are welcome any time.** Bug reports, feature ideas, "is this how I'm supposed to use it?" — all useful.
- **Small focused PRs are the easiest to land.** Bug fixes, doc improvements, dependency bumps, small UX polish — go for it.
- **For larger changes, open an issue first.** This protects your time more than mine — I want to make sure the direction makes sense before you write a lot of code.
- **Response time will vary.** I may not get to things immediately. That's not a reflection of how much I appreciate the contribution.

If at any point you want to use Raltic as a base for your own thing — fork it, rename it, take it in a different direction — that's fine. That's what MIT is for.

## Setup

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local
cp apps/bridge/.env.example    apps/bridge/.env
# fill in Cloudflare/better-auth/API values — see docs/SELF_HOSTING.md
pnpm dev:web        # Next.js dev server on :3000
pnpm dev:bridge     # Bridge in watch mode
```

Requirements: Node >= 20, pnpm 10, and Cloudflare resources for full-stack work. UI-only work can usually point `NEXT_PUBLIC_RALTIC_API_URL` at an existing staging API.

## Project layout

See the [README](README.md#repository-layout) for the monorepo overview. The most useful files when getting oriented:

- `packages/db/src/schema.ts` — Drizzle schema. Read this first for data shape.
- `packages/bridge-core/src/bridge.ts` — main local bridge loop. Connects to raltic-api, spawns local runtimes, routes messages.
- `packages/bridge-core/src/system-prompt.ts` — the prompt local CLI agents get on startup. Defines how agents behave inside Raltic.
- `packages/agent/src/raltic-agent.ts` — cloud-native agent Durable Object.
- `apps/web/src/app` — Next.js App Router routes, including the chat UI under `(chat)`.
- `packages/cli/src/index.ts` — the `raltic` CLI agents use to talk to the platform.

## Coding conventions

- TypeScript everywhere. No `any` unless you have a comment explaining why.
- Tailwind for styling. Check `apps/web/src/app/globals.css` and existing components before introducing a new color or layout pattern.
- For UI components, prefer composition over new primitives. We use Base UI (`@base-ui/react`) and a few shadcn-derived components in `apps/web/src/components/ui`.
- Keep PRs focused. Don't bundle "cleanup the surrounding area" with feature changes.

## Testing

Automated tests are expected for non-trivial logic. The current CI gates TypeScript, web lint, OpenNext/API/bridge builds, package tests, migration-import drift, and read-only Playwright smoke against an explicit deployment target.

Useful local commands:

```bash
pnpm test:migrations
pnpm test
pnpm --filter @raltic/web lint
E2E_BASE_URL=http://localhost:3000 E2E_API_URL=http://localhost:8787 pnpm e2e
```

Visual snapshots are opt-in and OS-specific:

```bash
E2E_RUN_VISUAL=1 E2E_BASE_URL=https://raltic.com E2E_API_URL=https://api.raltic.com pnpm e2e:visual
```

Mutating E2E (`E2E_RUN_AUTH=1`, `E2E_RUN_CHANNELS=1`) should run only against local or staging. These specs refuse production unless `E2E_ALLOW_PROD_WRITES=1` is set deliberately.

## Good first issues

A few low-risk things that would be genuinely helpful and don't require deep context:

- **Add CLI smoke tests** for argument parsing and JSON error output in `packages/cli`.
- **Expand desktop release smoke coverage** with signed-update checks against a staging GitHub Release.
- **Expand authenticated staging E2E** with a seeded account and cleanup strategy for channel/task flows.
- **Improve sandbox/container release docs** around image tags, rollback, and deploy ordering.

## Commits and PRs

- Conventional-commit-ish style (`feat:`, `fix:`, `chore:`, `docs:`) is appreciated but not enforced.
- A short PR description with **what** and **why** is more important than ceremony.
- Link to the related issue if there is one.

## Questions

If something is unclear, open a [discussion](https://github.com/Digidai/raltic/discussions) or just file an issue with the `question` label. No question is too small.

Thanks for being here.

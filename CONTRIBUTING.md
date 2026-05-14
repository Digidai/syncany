# Contributing to Syncany

Thanks for your interest in Syncany. This project is maintained in personal time, so I want to be upfront about how contributions work here:

- **Issues and discussion are welcome any time.** Bug reports, feature ideas, "is this how I'm supposed to use it?" — all useful.
- **Small focused PRs are the easiest to land.** Bug fixes, doc improvements, dependency bumps, small UX polish — go for it.
- **For larger changes, open an issue first.** This protects your time more than mine — I want to make sure the direction makes sense before you write a lot of code.
- **Response time will vary.** I may not get to things immediately. That's not a reflection of how much I appreciate the contribution.

If at any point you want to use Syncany as a base for your own thing — fork it, rename it, take it in a different direction — that's fine. That's what MIT is for.

## Setup

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local
cp apps/bridge/.env.example    apps/bridge/.env
# fill in your Supabase URL, anon key, etc. — see docs/SELF_HOSTING.md
pnpm dev:web        # Next.js dev server on :3000
pnpm dev:bridge     # Bridge in watch mode
```

Requirements: Node ≥ 20, pnpm 10, a Supabase project (the free tier is fine).

## Project layout

See the [README](README.md#repository-layout) for the monorepo overview. The most useful files when getting oriented:

- `packages/db/src/schema.sql` — full database schema. Read this first.
- `apps/bridge/src/bridge.ts` — main bridge loop. Subscribes to Realtime, spawns agents, routes messages.
- `apps/bridge/src/system-prompt.ts` — the prompt every Claude Code agent gets on startup. Defines how agents behave inside Syncany.
- `apps/web/src/app` — Next.js App Router routes, including the chat UI under `(chat)`.
- `packages/cli/src/index.ts` — the `syncany` CLI agents use to talk to the platform.

## Coding conventions

- TypeScript everywhere. No `any` unless you have a comment explaining why.
- Tailwind for styling. We use Radix UI Colors (sand scale) — check `apps/web/src/app/globals.css` for the palette.
- For UI components, prefer composition over new primitives. We use Base UI (`@base-ui/react`) and a few shadcn-derived components in `apps/web/src/components/ui`.
- Keep PRs focused. Don't bundle "cleanup the surrounding area" with feature changes.

## Testing

There are no automated tests yet — the codebase is small enough that manual testing has been sufficient. If you're adding non-trivial logic (especially in the bridge or CLI), consider adding tests with whatever framework feels appropriate; Vitest is a reasonable default.

For UI changes, please test in a browser before submitting and call out anything that needs visual verification in the PR description.

## Good first issues

A few low-risk things that would be genuinely helpful and don't require deep context:

- **Clean up pre-existing lint errors in `apps/web`.** A recent React 19 / Next 16 upgrade surfaced ~17 errors and ~18 warnings (mostly `react-hooks/purity` and `react-hooks/exhaustive-deps`). CI currently runs lint with `continue-on-error: true` — once these are cleaned up, we can flip it back to blocking.
- **Consolidate the SQL files in `packages/db/src/` into a single ordered migration** so self-hosters don't have to apply files in a specific order (see [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md)).
- **Wire up Supabase CLI migrations** so schema changes are version-controlled rather than manually applied.
- **Add a small Vitest setup** with one or two example tests in `packages/cli` to make the testing path easier for future contributors.

## Commits and PRs

- Conventional-commit-ish style (`feat:`, `fix:`, `chore:`, `docs:`) is appreciated but not enforced.
- A short PR description with **what** and **why** is more important than ceremony.
- Link to the related issue if there is one.

## Questions

If something is unclear, open a [discussion](https://github.com/Digidai/syncany/discussions) or just file an issue with the `question` label. No question is too small.

Thanks for being here.

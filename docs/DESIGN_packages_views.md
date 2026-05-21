# `packages/views` extraction (multica-style shared web+desktop)

## Why

Today every page in `apps/web` and every comparable surface in
`apps/desktop` duplicates layout, business logic, and routing. Examples
already present in the tree:

- `apps/web/src/app/s/[slug]/agents/page.tsx` ≈ desktop's agent profile
  flow, but rewritten because the web one imports `next/navigation` and
  `next/link`.
- The setup wizard, the workspace switcher, the message-area header,
  the people/agents/channels directory pages — every one of them
  will/does have a desktop sibling.

Multica solves this with a strict 3-package boundary
(`packages/core` for headless logic, `packages/ui` for atomic UI,
`packages/views` for shared business pages, and apps just compose).
We already have `core` + `ui`; `views` is the missing piece.

## Boundary contract (enforced by lint)

- `packages/views/*`: zero `next/*` imports, zero `react-router-dom`
  imports, zero `localStorage` (use the `StorageAdapter` from core).
  All routing goes through `NavigationAdapter` from `core`.
- `apps/web/platform/*`: the ONLY place `next/*` may appear.
- `apps/desktop/.../platform/*`: the ONLY place `react-router-dom` may
  appear.
- View components accept `{ slots, props, children }` to inject
  platform-specific chrome.

## Migration plan (incremental, per-PR)

1. **Set up the package skeleton** (this PR): package.json, tsconfig,
   ESLint rule. Empty `src/index.ts`. Added to `pnpm-workspace.yaml`.
2. **First migration** — move `welcome-toast.tsx` (smallest, ~30 LOC,
   no routing). Web imports from `@raltic/views/welcome-toast`.
3. **Pick a domain at a time**:
   - agents (3 pages: index, profile, settings/agents)
   - people (1 page + 1 dialog)
   - channels (1 page + 1 dialog)
   - sidebar (workspace-switcher, new-dm-dialog, agent-row)
   - wizard (the heavy lift — it's 600 LOC and has Next.js router calls)
4. **Each migration**: extract to `packages/views`, replace `next/*`
   calls with `NavigationAdapter`, expose props for the differences,
   delete the web copy, mirror in desktop.

## Not in this PR

The actual extraction. This is a tracking design doc; the package
skeleton lands separately when we have an empty afternoon to verify
ESLint enforcement works.

## Reference

- Multica's `packages/core/CLAUDE.md` "Package Boundary Rules" section
- Their `apps/web/platform/` directory shows the exact `next/*`
  isolation pattern we'd mirror.

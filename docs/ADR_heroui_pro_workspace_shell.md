# ADR: HeroUI Pro Workspace Shell First

Date: 2026-05-24

## Status

Accepted for Phase 1 implementation on `feature/heroui-pro-workspace-shell`.

## Context

Raltic's workspace UI is the authenticated `/s/[slug]` surface where channel chat, agents, DMs, tasks, people, and settings live. The current shell is custom Tailwind plus `@raltic/ui` primitives. The user has purchased HeroUI Pro and wants HeroUI Pro to become the preferred workspace application shell direction, without leaking Pro dependencies into shared or desktop packages.

Official setup constraints reviewed:

- HeroUI Pro React requires React 19 and Tailwind CSS 4.
- CSS order must place `@heroui/styles` and `@heroui-pro/react/css` immediately after `tailwindcss`.
- CI installs must provide `HEROUI_AUTH_TOKEN` for the Pro package postinstall path.
- HeroUI Pro Sidebar `MenuItem href` is React Aria TreeItem based, so Phase 1 must not silently change existing Next `<Link>` row semantics.

## Decision

Adopt HeroUI Pro in the workspace shell first, scoped to `apps/web`.

Phase 1 uses:

- `@heroui-pro/react`
- `@heroui/react`
- `@heroui/styles`
- HeroUI Pro `Sidebar.Provider`, `Sidebar.Root`, `Sidebar.Mobile`, `Sidebar.Header`, `Sidebar.Content`, and `Sidebar.Footer`

Phase 1 does not use HeroUI Pro `AppLayout` for the chat surface yet. The chat `MessageArea` owns its own `ScrollArea` viewport and stick-to-bottom behavior, so introducing another main content scroller is deferred until it can be browser-verified.

Phase 1 preserves:

- current Next `<Link>` semantics for Inbox, Tasks, Agents, People, channel rows, and DM rows
- `WorkspaceSwitcher` full page reload behavior for workspace switching
- `raltic:channels-changed` as the cross-component sidebar refresh contract
- `UserPill` Base UI dropdown structure
- `MessageArea` and `@raltic/ui` `ScrollArea` internals
- `packages/ui`, desktop, bridge, API, DB, and protocol boundaries

## Implementation Notes

HeroUI Pro is installed only in `apps/web/package.json`.

Root `package.json` keeps `pnpm.onlyBuiltDependencies` for:

- `@heroui-pro/react`
- `heroui-pro`
- `electron`

`electron` remains allowed because the monorepo desktop package needs its install script. `heroui-native-pro` is intentionally not allowed because it is not installed.

Workspace shell structure:

- `WorkspaceShell` owns the fixed viewport and mobile header.
- `Sidebar.Provider` is route-scoped to the workspace shell.
- Provider is controlled with `open` and `toggleShortcut={false}` to avoid `sidebar_state` cookies and `Cmd+B` / `Ctrl+B` conflicts.
- Desktop renders one HeroUI Pro `Sidebar.Root`.
- Mobile opens one HeroUI Pro `Sidebar.Mobile` via a custom button using `useSidebar().setMobileOpen(true)`.
- Desktop and mobile sidebar content are mutually rendered with `isMobile` to avoid duplicate channel hooks.

## Consequences

Benefits:

- HeroUI Pro becomes the workspace shell foundation without rewriting chat internals.
- Navigation row semantics remain stable for existing tests and user workflows.
- Mobile has an explicit workspace navigation entrypoint.
- CI can install the Pro package when `HEROUI_AUTH_TOKEN` is configured.

Costs and risks:

- HeroUI Pro is still beta (`@heroui-pro/react@1.0.0-beta.4`), so shell styles use some defensive overrides.
- Authenticated workspace browser tests require `E2E_RUN_WORKSPACE=1`, `RALTIC_E2E_EMAIL`, and `RALTIC_E2E_PASSWORD`.
- Full visual verification needs a real authenticated workspace session.

## Verification Gates

Required before merging Phase 1:

- `pnpm --filter @raltic/web lint`
- `pnpm --filter @raltic/web exec tsc --noEmit -p tsconfig.json`
- `pnpm --filter @raltic/web build`
- `cd apps/web && npx opennextjs-cloudflare build`
- `E2E_BASE_URL=... E2E_API_URL=... E2E_RUN_WORKSPACE=1 RALTIC_E2E_EMAIL=... RALTIC_E2E_PASSWORD=... pnpm e2e -- workspace-shell-readonly.spec.ts`
- `rg "@heroui|@heroui-pro" packages/ui apps/desktop packages/bridge-core` must return no matches

## Deferred

- Migrating row rendering to HeroUI Pro `Sidebar.MenuItem`
- HeroUI Pro `AppLayout` for chat routes
- Workspace a11y axe expansion beyond the new shell smoke gate
- Bundle budget baseline and gzip delta reporting for workspace chunks
- Removing legacy Base UI dropdowns from `UserPill`

## 2026-05-25 Visual Pass Amendment

The first implementation proved the technical integration but did not create a visibly different workspace. It kept too much of the old visual language:

- `Sidebar.Root` was forced transparent and shadowless.
- Navigation rows still used the old cyan left-rule active state.
- `WorkspaceSwitcher`, `UserPill`, and the composer kept flat legacy surfaces.
- The chat main panel looked like the previous card with slightly larger radius.

The corrected visual pass keeps the same architectural constraints but changes the visible shell:

- Use HeroUI Pro `Sidebar.Provider` in `floating` mode.
- Let the desktop sidebar read as a distinct floating rail with border, blur, and elevation.
- Turn active navigation into a full selected pill instead of a left accent line.
- Make `WorkspaceSwitcher` and `UserPill` look like Pro sidebar controls.
- Make the chat header and composer part of the same inset application panel.

Still preserved:

- HeroUI Pro remains scoped to `apps/web`.
- `packages/ui`, desktop, API, bridge, DB, protocol, auth, and realtime contracts stay untouched.
- Existing Next `<Link>` navigation semantics remain in place until the `Sidebar.MenuItem` migration has its own browser-verified pass.
- `raltic:channels-changed`, unread seeding, presence, dialogs, and message scroll behavior remain acceptance constraints.

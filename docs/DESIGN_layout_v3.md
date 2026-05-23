# Layout v3 — three borrowings from Multica

Status: **PROPOSAL — awaiting user decision per item**
Author: deep-research pass on multica-ai/multica frontend
Last updated: 2026-05-23

---

## 0. TL;DR

Multica (multica-ai/multica) ships a polished frontend with three patterns
worth stealing for raltic. Each is independent — you can take 0, 1, 2,
or 3. None is critical; all reduce future tech debt.

| # | Pattern | Effort | Risk | Why bother |
|---|---|---|---|---|
| **1** | `oklch` color tokens with opacity scale | small | low | reduces named-color sprawl; semantic hierarchy via `/40`–`/92` |
| **2** | `(marketing)` route group isolation | medium | low-medium | per-scope fonts/theme; marketing-only deps don't bloat app bundle |
| **3** | Unified workspace switcher dropdown | medium | medium (touches UserPill, WorkspaceSwitcher) | one tap for identity + workspace list + settings + invites |

Recommendation: take **1 (token scale)** and **2 (route group isolation)** —
both are mechanical refactors with clear win. Hold **3 (switcher unification)**
unless you want to redo sidebar bottom-left twice in a row.

---

## 1. Why a research-based proposal

The post-session work has accumulated UI debt: 5+ color tokens for online
status across sidebar / user-pill / message-area, two layout components
that both load marketing fonts even on workspace pages, and two separate
chrome elements (top-left WorkspaceSwitcher + bottom-left UserPill) doing
related work.

Multica solved similar issues and their solutions are public + apache 2.
This doc captures **what to copy, what to adapt, what to skip**.

---

## 2. Item #1 — `oklch` color tokens with opacity scale

### Current raltic state

Hardcoded named colors in component-local className strings:
- `text-emerald-700 dark:text-emerald-400` (Online label)
- `bg-emerald-500/10` (online dot bg)
- `text-cyan-300` / `text-amber-300` (runtime accents)
- `border-zinc-800` / `bg-zinc-950` (sidebar bg)
- ~12 distinct color names across marketing + app components

### Multica state

```css
:root {
  --brand:    oklch(0.55 0.16 255);            /* hue 255 = blue */
  --sidebar:  oklch(0.985 0 0);                /* near-white */
  --sidebar-accent: oklch(0.95 0.002 286.375);
  --primary:  oklch(0.21 0.006 285.885);
}
```

Then in JSX:
```tsx
className="text-white/92"   // high-contrast body
className="text-white/70"   // secondary
className="text-white/40"   // muted
```

Opacity scale (`/40`, `/50`, `/70`, `/84`, `/92`) replaces second-color
definitions. Color stays one token; opacity carries hierarchy.

### What to steal

Define 5 semantic tokens in `apps/web/src/app/globals.css`:
```css
:root {
  --raltic-fg:        oklch(0.98 0 0);
  --raltic-bg:        oklch(0.07 0 0);
  --raltic-accent:    oklch(0.78 0.15 195);    /* cyan brand */
  --raltic-warn:      oklch(0.78 0.16 70);     /* amber */
  --raltic-danger:    oklch(0.65 0.22 25);     /* rose */
}
```

Use as `text-[oklch(0.98_0_0_/_0.92)]` OR (better) tailwind v4 lets you
just reference `text-(--raltic-fg)/92`.

Codemod the existing `text-zinc-300` → `text-(--raltic-fg)/70`,
`text-zinc-500` → `text-(--raltic-fg)/50`, etc. ~50 grep-and-replace
hits across the codebase.

### What to skip

Don't migrate runtime accent colors (`cyan` for Claude, `amber` for Codex,
`violet` for OpenClaw, `rose` for Hermes) — those are deliberately brand-
specific. Keep as full named colors so visual identity stays.

### Effort + risk

- **Effort**: ~2 hours grep+replace + visual regression sweep
- **Risk**: low — color values stay close, no JS changes
- **Tests**: visual-snapshots.spec.ts catches anything that drifts >5%

### Open questions

- Tailwind 4 already supports oklch tokens; do we need to upgrade or is current
  version OK? (verify in `apps/web/package.json`)
- Light mode parity — multica targets light; we're dark-first. Make sure
  the `/92` opacity reads on dark bg (it does — that's their dark mode too).

---

## 3. Item #2 — `(marketing)` route group isolation

### Current raltic state

`apps/web/src/app/layout.tsx` is the SINGLE root layout. Everything (signup,
login, workspace, marketing pages) inherits:
- The same font loading (whatever's in layout)
- The same theme provider chain
- The same SignedInRedirect ... wait, we already removed that from
  marketing pages. But the root metadata template `"%s — Raltic"` applies
  to workspace pages too, which is weird.

### Multica state

```
apps/web/app/
├── layout.tsx                        # global root (minimal)
├── (landing)/
│   ├── layout.tsx                    # marketing-only: serif font, light-mode lock, LocaleProvider
│   ├── page.tsx                      # homepage
│   ├── changelog/page.tsx
│   └── pricing/page.tsx
└── [workspaceSlug]/
    ├── layout.tsx                    # auth guard + slug provider
    └── (dashboard)/
        ├── layout.tsx                # DashboardLayout (sidebar + topbar)
        └── ...
```

Three layout layers: root → scope (landing OR workspaceSlug) → feature
(landing pages OR dashboard).

Benefits:
- Marketing fonts (Instrument Serif) only load on landing scope
- Theme lock (light vs dark vs system) per scope
- Different metadata template per scope
- Bundle splitting per route group

### What to steal

Reorganize:
```
apps/web/src/app/
├── layout.tsx                        # KEEP minimal — fonts, ThemeProvider, GlobalError
├── (marketing)/                      # NEW route group
│   ├── layout.tsx                    # MarketingShell wraps everything inside
│   ├── page.tsx                      # = current homepage
│   ├── indie/page.tsx                # move
│   ├── teams/page.tsx                # move
│   ├── connectors/page.tsx           # move
│   ├── security/page.tsx             # move
│   ├── privacy/page.tsx              # move
│   ├── terms/page.tsx                # move
│   └── runtimes/                     # move
├── (auth)/                           # already exists
│   ├── login/
│   ├── signup/
│   └── ...
└── s/[slug]/                         # workspace (unchanged)
```

`(marketing)/layout.tsx` would:
- Wrap children in MarketingShell (already exists at components/marketing/shell.tsx)
- Define marketing-scoped metadata template
- Lock dark mode for marketing pages (current default)
- Inject Cloudflare Web Analytics script (currently global)

### What to skip

Don't move `/login`, `/signup`, etc into `(marketing)` — they have their
own minimal Card layout and don't need MarketingShell.

### Effort + risk

- **Effort**: ~3 hours — move 11 page.tsx files + create 1 layout + run E2E
- **Risk**: medium — Next App Router route groups don't change URLs, but
  sitemap.ts hardcodes URLs (stays valid), and middleware.ts PUBLIC_MARKETING
  uses pathname (stays valid). Hidden risk: any deep imports referencing
  `apps/web/src/app/runtimes/...` break if pathing changes.
- **Tests**: E2E suite (`pnpm e2e`) covers public-access, sections,
  cta-nav, security headers — would catch a regression.

### Open questions

- Where does `<MarketingShell>`'s `<MarketingTracking>` belong now? In the
  new `(marketing)/layout.tsx` instead of per-page? Probably yes.
- Should `/api/marketing/event` move too? Conceptually it's marketing-scoped,
  but Next.js route groups don't apply to `/api/*` (no layout cascade).
  Keep where it is.

---

## 4. Item #3 — Unified workspace switcher dropdown

### Current raltic state

**Top-left**: `WorkspaceSwitcher` — workspace name + logo + dropdown with
"Your workspaces" + "Joined" + "Create" + invites? not sure.

**Bottom-left**: `UserPill` — user avatar + name + "Online" + dropdown with
"Signed in as X" + Account + Workspace settings + Sign out.

Total: 2 click affordances doing partially-overlapping work. The user
already flagged the gear-vs-dropdown redundancy (we removed it last batch).

### Multica state

**Top-left**: single `WorkspaceSwitcher` dropdown handles EVERYTHING:
- Current workspace name + avatar
- Dropdown reveals:
  - User identity card at top (avatar, name, email)
  - List of OTHER workspaces with checkmark on current
  - "Create Workspace" button
  - **Pending Invitations** section (with per-row Accept / Decline)
  - Logout button (destructive variant)

**No bottom user pill at all.** All identity + workspace + auth lives top-left.

### What to steal

Two options:

#### Option A — full unification (Multica path)
- Delete `UserPill` and its bottom-left footer slot
- Extend `WorkspaceSwitcher` dropdown to include: user identity card +
  Account + Workspace settings + Sign out + Pending invitations
- Sidebar bottom becomes empty (or gets a "?" Help button)
- Saves ~50 lines + collapses 2 menus into 1

#### Option B — keep both, sharpen division of labor
- `WorkspaceSwitcher` (top-left): workspace ops only (switch, create, invites)
- `UserPill` (bottom-left): user ops only (account, sign out, status)
- Currently both have "Workspace settings" → only top-left should have it
- Visual separation: top-left = workspace scope, bottom-left = user scope

### What to skip

Don't copy Multica's lack-of-status-indicator. We just shipped real
workspace presence — keep the "Online" affordance somewhere
(either in UserPill OR move next to avatar in workspace switcher).

### Effort + risk

- **Option A effort**: ~4 hours — extend WorkspaceSwitcher, delete UserPill,
  update sidebar.tsx footer, migrate tests
- **Option A risk**: medium-high — bigger dropdown = more places to break;
  the new "everything in one menu" UX may feel cluttered at first;
  recently-shipped sidebar footer v2 just settled
- **Option B effort**: ~1 hour — move "Workspace settings" out of UserPill,
  add it to WorkspaceSwitcher, document the division
- **Option B risk**: low — just a small reshuffle

### Recommendation

**Option B** if you take this at all. Reason: we *just* did sidebar footer
v2 (codex-reviewed) two commits ago. Doing Option A would mean a third
revision of the same UI in one week — costs reader/contributor trust.
Keep B as a refinement; let the new bottom pill bake for a few weeks
before any unification.

---

## 5. What NOT to copy from Multica

- **Flat 3-group sidebar without collapsibles** — works for Multica because
  they have 6 top-level routes max. Raltic has variable channel + DM counts.
- **Chat as floating FAB instead of nav item** — first-class navigation
  beats overlay UX for chat.
- **`h-svh` + internal scroll** — mobile keyboard breaks this. Use flexbox.
- **Locale toggle in footer** — we're EN-only for now; adding zh-CN is
  a separate effort, not a layout decision.

---

## 6. Decision matrix — pick per item

| Item | Take (yes/no)? |
|---|---|
| 1. oklch token scale | _____ |
| 2. (marketing) route group | _____ |
| 3a. WorkspaceSwitcher unification (full) | _____ |
| 3b. WorkspaceSwitcher sharpening (light) | _____ |

If you say yes to any, the next step is:
- For 1: I add tokens, run grep+replace, visual regression sweep
- For 2: I move 11 page files into `(marketing)/`, add layout, re-test
- For 3a/3b: I draft the dropdown extension first, get your visual sign-off,
  then ship

Each fits in one focused commit. All independent — order doesn't matter.

---

## 7. Out of scope

- New sidebar features (Pinned items / drag-to-reorder) — separate idea
  worth its own design
- Multica's marketing copy patterns — they sell to a different buyer (eng
  managers) than raltic's "dual-mode for any dev team"
- Localization infrastructure

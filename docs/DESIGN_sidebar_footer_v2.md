# Sidebar bottom-left footer — UX cleanup

Status: **PROPOSAL — awaiting codex review + user approval**
Author: response to user feedback
Last updated: 2026-05-23

---

## 0. Problem statement

User feedback verbatim:

> 底部 G Gene 用户名旁边的绿点是什么意思，以及设置按钮为何在哪里。
> 系统菜单是点击头像展开的。

Translated:
1. What does the green dot next to the username mean? (meaning unclear)
2. Why is the settings (gear) button there? (the user is observing the dropdown already exposes Settings via avatar click — so why a duplicate?)

---

## 1. Current implementation

`apps/web/src/components/sidebar.tsx:231-243` renders:

```
┌──────────────────────────────────────────────────────────────┐
│ [G] Gene                              ●  ▲       │   ⚙     │
│  ↑                                    ↑  ↑           ↑      │
│  avatar (initial circle)              │  │           gear   │
│                                       │  chevron-up         │
│                                       green dot             │
└──────────────────────────────────────────────────────────────┘
   └──── UserPill (avatar+name+dot+chevron, click → dropdown) ──┘
   └──── Settings Link (gear → /s/.../settings/workspace) ──────┘

Dropdown content (on avatar click):
   "Signed in as gene@..."
   • Account             → /s/.../settings/account
   • Workspace settings  → /s/.../settings/workspace   ← DUPLICATE
   ─────
   • Sign out
```

**Diagnosed issues:**

| # | Issue | Severity | Evidence |
|---|---|---|---|
| **U1** | Settings gear duplicates "Workspace settings" in the avatar dropdown. Two clicks to the same destination. | HIGH | `sidebar.tsx:235-242` (gear) and `user-pill.tsx:99-103` (dropdown item) both → `/s/${slug}/settings/workspace` |
| **U2** | Green dot meaning isn't self-evident. After the recent presence work it IS meaningful (other teammates see your green when your tab is open) but no visible label tells the user that. The aria-label "Online" + title attribute "Online — other workspace members see this dot too" is invisible until hover. | MED | `user-pill.tsx:83-88` |
| **U3** | Footer has 5 visual elements (avatar / name / dot / chevron / gear) crammed into ~36px height — competes for attention. | LOW | Same line as U1 |
| **U4** | The dropdown's "Workspace settings" is itself slightly mis-labeled — clicking goes to the workspace SETTINGS PAGE which has sub-tabs (Members / Agents / Connectors / Account). A user looking for "Account" probably won't expect it under "Workspace settings". Lower-priority since "Account" is its own dropdown item. | LOW | Same |

---

## 2. Industry comparison

| Product | Bottom-left footer affordances |
|---|---|
| **Slack** | Avatar with status dot · Click → menu (Set yourself as away / Pause notifications / Profile / Preferences / Sign out). No separate gear. Status dot is INTERACTIVE (click in menu to toggle). |
| **Discord** | Avatar + name + tag + status dot · Inline icons for mute / deafen / **user settings** (gear). Settings here is USER-scoped (not server-scoped). Status set via right-click on avatar. |
| **Linear** | Avatar + name only (with chevron on hover). Settings via `cmd+,` or via main nav. |
| **Notion** | Just avatar (no name in sidebar). Settings via cmd+, or top-right menu. |

**Pattern**: the gear button at the bottom-left is ALWAYS user-scoped (Discord) or absent (Slack/Linear/Notion). Raltic's gear is workspace-scoped — closer to the WorkspaceSwitcher's mental model than the user pill's. Putting it next to the user pill creates confusion (clicked the wrong block first half the time).

---

## 3. Design options

### Option A — minimal cleanup (Recommended)

Changes:
1. **Remove the gear button** from `sidebar.tsx` footer. Workspace settings is already reachable via:
   - Avatar dropdown → "Workspace settings"
   - URL: `/s/{slug}/settings/workspace`
   - Will also be reachable via WorkspaceSwitcher dropdown if we add it (out of scope).
2. **Add a visible status label** next to the dot so the meaning is obvious without hover:
   `[avatar] Gene  ● Online           ▲`
   - "Online" text uses small, muted styling (text-[10px] text-muted-foreground)
   - Only shows when the dot is green; when red/amber/zinc the dot+label flip together
3. **Dropdown adds a "Status" line** at the top, mirroring Slack:
   ```
   ● Online · visible to teammates       ← non-interactive line; future-tense interactive
   ───
   Signed in as gene@…
   ───
   Account
   Workspace settings
   ───
   Sign out
   ```

Pros: smallest diff; immediately fixes both reported issues; gives us a place to grow status states later.
Cons: doesn't add a NEW capability (some users may want a settings shortcut).

### Option B — keep gear, repurpose it as User settings

Changes:
1. Keep the gear icon but route it to **`/s/{slug}/settings/account`** (USER scope), not `/workspace`.
2. Tooltip becomes "Your account settings" so it's clearly user-scoped (matches Discord's pattern).
3. Add the status label as in Option A.

Pros: keeps a one-click shortcut to user settings.
Cons: still 5-element-cluttered; muddies the visual hierarchy because user-settings is also in the dropdown.

### Option C — full status picker

Changes:
1. Remove gear.
2. Replace the dot with an interactive STATUS button (click → popover with Online / Away / Do not disturb / Set custom).
3. Visible status label.

Pros: most polished, Slack-equivalent.
Cons: needs a backend (presence-status field on `users`), DO write path, server broadcast on change, away-timer logic. Out of scope for the immediate ask.

---

## 4. Recommendation

**Option A** — ships the minimum that addresses both reported problems with the smallest blast radius. Option C is the destination but needs a separate effort (presence-status field, away timer, DO broadcast).

---

## 5. Detailed implementation (Option A)

### 5.1 `sidebar.tsx` footer

```tsx
{/* Footer: identity-only. Workspace settings is reachable via the
    avatar dropdown's "Workspace settings" item. We used to ship a
    separate gear icon here, but it duplicated the dropdown item AND
    confused the visual scan (two adjacent menu-like affordances at
    the same level competing for the same click). */}
<div className="border-t px-2 py-2">
  <UserPill serverSlug={serverSlug} />
</div>
```

The gear `<Link>` + outer flex wrapper go away. Pill takes full width.

Remove the `Settings` import from `sidebar.tsx` (no longer used).

### 5.2 `user-pill.tsx` — status label visible

```tsx
<div className="min-w-0 flex-1">
  <div className="truncate text-xs font-medium leading-tight">{user.name ?? user.email}</div>
  <div className="mt-0.5 flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
    <span
      className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.55)]"
      aria-hidden="true"
    />
    Online
  </div>
</div>
<ChevronUp className="h-3 w-3 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true" />
```

Notes:
- The dot is now decorative (`aria-hidden`) because the text "Online" carries the meaning for screen readers.
- The shadow glow on the dot is reduced (0_0_4px) to look balanced under text vs. floating alone.
- Vertical spacing: `py-1.5` on the trigger stays the same; the label adds ~14px of internal height. Acceptable — Slack's pill is even taller.

### 5.3 `user-pill.tsx` — dropdown header

```tsx
<DropdownMenuContent ...>
  <DropdownMenuGroup>
    {/* New: visible status line at the top of the menu. Mirrors the
        in-line "Online" label so the menu provides the same affordance
        for keyboard / a11y users who can't see the inline. */}
    <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      Online · visible to teammates
    </DropdownMenuLabel>
    <DropdownMenuLabel className="truncate text-[10.5px] font-normal text-muted-foreground">
      {user.email ?? user.name}
    </DropdownMenuLabel>
  </DropdownMenuGroup>
  <DropdownMenuSeparator />
  <DropdownMenuItem render={<Link href={`/s/${serverSlug}/settings/account`} />}>
    <UserIcon className="h-4 w-4" />
    Account
  </DropdownMenuItem>
  <DropdownMenuItem render={<Link href={`/s/${serverSlug}/settings/workspace`} />}>
    <SettingsIcon className="h-4 w-4" />
    Workspace settings
  </DropdownMenuItem>
  <DropdownMenuSeparator />
  <DropdownMenuItem onClick={handleSignOut} variant="destructive">
    <LogOut className="h-4 w-4" />
    Sign out
  </DropdownMenuItem>
</DropdownMenuContent>
```

### 5.4 No backend changes

This is pure UI. Presence is already real (workspace-presence DO ships; `useWorkspacePresence` hook returns the live map). The "Online" label reflects the existing always-online-while-tab-open invariant.

---

## 6. Future iteration (out of scope for this diff)

- Click on the status line → opens a small picker (Online / Away / Do not disturb / Set custom).
- Status persisted on `users.presenceStatus` column.
- WorkspacePresence DO broadcasts the status alongside online/offline so sidebar dots can render an amber half-moon for Away, a red Do-not-disturb badge, etc.
- Settings keyboard shortcut (cmd+, opens user-settings dialog) replaces the dropdown item entry point.

---

## 7. Test plan

E2E (`e2e/user-pill.spec.ts` — new):
1. Open `/s/{slug}/...` (signed in via E2E_RUN_AUTH)
2. Footer renders the UserPill at full width (no sibling gear icon present)
3. Inline "Online" label visible next to avatar
4. Avatar click → dropdown opens
5. Dropdown header line "Online · visible to teammates" visible
6. Click "Workspace settings" → navigates to `/s/{slug}/settings/workspace`
7. Click "Account" → navigates to `/s/{slug}/settings/account`
8. Click "Sign out" → redirected to `/login`

Visual regression: snapshot the footer area at desktop + iPhone widths.

A11y: axe-core scan must report 0 critical/serious on the workspace page after change (re-run existing `e2e/a11y-axe.spec.ts`).

---

## 8. Migration / rollback

- No data migration.
- Rollback = revert the commit; the gear comes back. Zero state to undo.

---

## 9. Open questions for codex review

1. Is removing the gear acceptable given some power users might rely on the one-click shortcut, OR is it strictly an improvement?
2. Is the inline "Online" label readable at the existing footer height, or does it crowd? Should we instead put the status ONLY in the dropdown and keep the inline a simple decorative dot?
3. Is "visible to teammates" the right phrasing for the status hint, or is "Other workspace members see you as online" clearer?
4. Should the "Online" label use sentence-case (Online) or all-lowercase (online) given the existing Tailwind/typography conventions?
5. Anything else missing — e.g. should we add a `cmd+,` keyboard shortcut to the menu items so power users get a shortcut without the gear icon?

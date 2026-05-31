"use client";

import { useSession, signOut } from "@/lib/auth-client";
import { ChevronUp, LogOut, Settings as SettingsIcon, User as UserIcon } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/heroui-pro/menu";
import { notifyThrown } from "@/lib/notify";

/**
 * Sidebar-bottom identity pill — current user avatar + name + menu.
 *
 * Slack/Discord pattern: the user knows-which-account-they're-in cue
 * lives at the bottom-left, separate from workspace controls (which
 * live at the top-left via WorkspaceSwitcher). Keeping the two affordances
 * physically apart means user-scope actions (sign out, profile)
 * don't get confused with workspace-scope actions (switch workspace,
 * rename, invite).
 *
 * The menu is intentionally small: profile, sign out. Status setting,
 * keyboard-shortcut cheatsheet, theme toggle can all land here later
 * without restructuring.
 */
export function UserPill({ serverSlug }: { serverSlug: string }) {
  const { data: session, isPending } = useSession();

  async function handleSignOut() {
    try {
      await signOut();
      // Full reload to /login — drops any in-memory user state cleanly,
      // matches the WorkspaceSwitcher sign-out path so behaviour stays
      // consistent regardless of which menu the user used.
      window.location.assign("/login");
    } catch (e) {
      notifyThrown("Sign out failed", e);
    }
  }

  // Skeleton during initial session load. Reserves the same TWO-LINE
  // height as the resolved pill (name row + status row) so hydration
  // doesn't push the sidebar layout when the session lands. Codex
  // review MED — without the reservation the footer jumps ~14px.
  if (isPending || !session?.user) {
    return (
      <div className="flex items-center gap-2 rounded-[9px] border border-border bg-surface/85 px-2 py-1.5 !shadow-none dark:border-white/10 dark:bg-white/5">
        <div className="h-8 w-8 animate-pulse rounded-xl bg-muted/60" />
        <div className="min-w-0 flex-1">
          {/* Skeleton heights match the resolved pill: name row uses
              text-xs (~12px) → h-3 placeholder; status row uses
              text-[10px] (~10-11px) → h-3 placeholder. mt-0.5 (~2px)
              mirrors the SelfStatusLine spacing so hydration is
              zero-drift. Claude review M3. */}
          <div className="h-3 w-20 animate-pulse rounded bg-muted/40" />
          <div className="mt-0.5 h-3 w-14 animate-pulse rounded bg-muted/30" />
        </div>
      </div>
    );
  }

  const user = session.user;
  const initial = (user.name ?? user.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="user-pill-trigger"
        className="group flex w-full items-center gap-2 rounded-[9px] border border-border bg-surface/85 px-2 py-1.5 text-left !shadow-none transition-colors hover:border-accent/25 hover:bg-surface focus:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
        // No aria-label here — when present, it OVERRIDES the accessible
        // name computed from contents, hiding the visible username from
        // screen readers. The trigger's accessible name now comes from
        // its inner text (name + sr-only ", online" + "Account menu"
        // helper). Claude review M4.
      >
        {user.image ? (
          // Untrusted URL → no-referrer keeps it from leaking who-uses-Raltic
          // to the avatar host. Same precaution as workspace icon img.
          <img
            src={user.image}
            alt=""
            className="h-8 w-8 shrink-0 rounded-xl object-cover ring-1 ring-white/70 dark:ring-white/10"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-amber-500 text-xs font-semibold text-white shadow-sm">
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium leading-tight">
            {user.name ?? user.email}
            {/* sr-only suffix so AT reads "Gene, online, account menu"
                without duplicating "Online" twice. Visible status is
                rendered by SelfStatusLine below. */}
            <span className="sr-only">, online, account menu</span>
          </div>
          {/* Visible status line so the green dot's meaning isn't
              hover-locked. The dot is aria-hidden because the visible
              word "Online" carries the meaning for assistive tech
              (mirrored in the sr-only suffix above for AT users). */}
          <SelfStatusLine />
        </div>
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] bg-default text-muted-foreground transition-colors group-hover:bg-[var(--accent-soft)] group-hover:text-[var(--accent-soft-foreground)] dark:bg-white/10">
          <ChevronUp className="h-3 w-3" aria-hidden="true" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={4} className="w-60">
        {/* HeroUI/RAC menu labels are grouped so assistive tech reads
            identity metadata separately from actionable menu items. */}
        <DropdownMenuGroup>
          {/* Status row — mirrors the inline label below the username
              + adds the explanatory subcopy ("teammates can see this")
              that wouldn't fit inline. Non-interactive in v1; the
              future status picker (Online / Away / Do not disturb)
              replaces this row's onClick. */}
          <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
            Online · teammates can see this
          </DropdownMenuLabel>
          <DropdownMenuLabel className="truncate text-[10.5px] font-normal text-muted-foreground">
            {user.email ?? user.name}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem href={`/s/${serverSlug}/settings/account`}>
          <UserIcon className="h-4 w-4" />
          Account
        </DropdownMenuItem>
        <DropdownMenuItem href={`/s/${serverSlug}/settings/workspace`}>
          <SettingsIcon className="h-4 w-4" />
          Workspace settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} variant="destructive">
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Inline status line shown under the user's name in the sidebar pill.
 * Extracted so the next-iteration status picker (Online / Away / Do
 * not disturb / Custom) can swap this for a clickable button without
 * restructuring the pill. Codex review LOW — forward-compat.
 *
 * Currently always renders "Online" because the existing presence
 * model is binary (tab open = online) — `useWorkspacePresence` shows
 * teammates the same green while this tab holds the UserGateway WS.
 */
function SelfStatusLine() {
  return (
    <div className="mt-0.5 flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
      <span
        className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_4px_rgba(16,185,129,0.55)]"
        aria-hidden="true"
      />
      Online
    </div>
  );
}

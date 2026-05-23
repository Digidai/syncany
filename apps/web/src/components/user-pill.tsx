"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import { ChevronUp, LogOut, Settings as SettingsIcon, User as UserIcon } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
  DropdownMenuGroup,
} from "@raltic/ui/components/ui/menu";
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
  const router = useRouter();
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

  // Skeleton during initial session load — fixed width so the layout
  // doesn't jump when session resolves.
  if (isPending || !session?.user) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
        <div className="h-6 w-6 animate-pulse rounded-full bg-muted/60" />
        <div className="h-3 w-20 animate-pulse rounded bg-muted/40" />
      </div>
    );
  }

  const user = session.user;
  const initial = (user.name ?? user.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
        aria-label="Account menu"
      >
        {user.image ? (
          // Untrusted URL → no-referrer keeps it from leaking who-uses-Raltic
          // to the avatar host. Same precaution as workspace icon img.
          <img
            src={user.image}
            alt=""
            className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-border"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/10 text-[10px] font-semibold text-cyan-700 dark:text-cyan-400">
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium leading-tight">{user.name ?? user.email}</div>
        </div>
        {/* Self-presence dot. Always green when this tab is open —
            that's the source of truth for "am I online" since the
            UserGateway WS we hold IS what the WorkspacePresence DO
            counts. Other workspace members see the same green via
            their own presence subscription. (Used to be hardcoded
            static green with "presence not tracked yet" comment;
            now it's still always green for SELF but it's actually
            true — and other workspace members see it as such too.) */}
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]"
          aria-label="Online"
          title="Online — other workspace members see this dot too."
        />
        <ChevronUp className="h-3 w-3 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={4} className="w-56">
        {/* Base UI 1.4 requires MenuGroupLabel (= DropdownMenuLabel) to
            be wrapped in a MenuGroup. Without it, opening the menu throws
            "Base UI error #31: MenuGroupContext is missing" and the entire
            page hits the root error boundary. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate text-[10.5px] font-normal text-muted-foreground">
            Signed in as {user.email ?? user.name}
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
    </DropdownMenu>
  );
}

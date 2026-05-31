"use client";

// Workspace switcher — sits at the top of the sidebar. Replaces the static
// "logo + name" block. Click opens a dropdown listing every workspace the
// signed-in user is a member of, with a "Create workspace" CTA at the
// bottom.
//
// Design constraints:
//   • Reads the workspace list lazily, on first hover/click — most renders
//     are noise and the API hit ($) isn't free on Cloudflare Workers.
//   • Active workspace shown with a check + cyan accent so the dropdown
//     doubles as orientation, not just navigation.
//   • Create CTA routes to "/" (home / wizard entry) which already handles
//     the new-workspace flow; we don't dialog-up creation here because the
//     sidebar is too narrow to host the form.

import { useRef, useState, useEffect } from "react";
import { ChevronDown, Check, Building2, LogOut, Star } from "lucide-react";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { notifySuccess, notifyThrown } from "@/lib/notify";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/heroui-pro/menu";

// Workspace row from /me — includes role + the user's chosen default.
interface MeServer {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  role: "owner" | "admin" | "member";
  joinedAt: number;
}

export function WorkspaceSwitcher({
  currentServerId, currentServerName, currentServerSlug, currentIconUrl,
}: {
  currentServerId: string;
  currentServerName: string;
  currentServerSlug: string;
  currentIconUrl?: string | null;
}) {
  const [servers, setServers] = useState<MeServer[] | null>(null);
  const [defaultServerId, setDefaultServerId] = useState<string | null>(null);
  // Pending state for the "Set as default" click — UI feedback while the
  // PATCH /me/default-server round-trip runs.
  const [pendingDefault, setPendingDefault] = useState<string | null>(null);
  const pendingDefaultRef = useRef<string | null>(null);
  // In-flight ref so rapid hover/focus/click doesn't issue duplicate
  // requests. Plain `loading` state lags one render behind setState; a ref
  // updates synchronously so the guard is reliable.
  const inFlight = useRef(false);
  const loadVersion = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function ensureLoaded() {
    if (servers || inFlight.current) return;
    const version = ++loadVersion.current;
    inFlight.current = true;
    try {
      // Use /me instead of listServers so we get role + default in a
      // single round-trip. listServers will eventually be deprecated for
      // this surface; we keep it for other callers (home-cta, etc.).
      const me = await api.me();
      if (mounted.current && version === loadVersion.current) {
        setServers(me.servers);
        setDefaultServerId(me.defaultServerId);
      }
    } catch (e) {
      notifyThrown("Couldn't load workspaces", e);
    } finally {
      if (version === loadVersion.current) inFlight.current = false;
    }
  }

  async function handleSetDefault(serverId: string) {
    if (pendingDefaultRef.current) return;
    pendingDefaultRef.current = serverId;
    setPendingDefault(serverId);
    try {
      await api.setDefaultServer(serverId);
      if (mounted.current) {
        setDefaultServerId(serverId);
        notifySuccess("Default workspace updated");
      }
    } catch (e) {
      notifyThrown("Couldn't update default workspace", e);
    } finally {
      pendingDefaultRef.current = null;
      if (mounted.current) setPendingDefault(null);
    }
  }

  // Cross-workspace navigation: use location.assign so the entire app
  // shell re-mounts. router.push leaves the WS gateway, DO subscriptions,
  // and any per-server React-context providers holding stale state for
  // the prior workspace, and we've already seen "phantom unread badges"
  // bugs from that pattern in this codebase.
  function switchTo(slug: string) {
    if (slug === currentServerSlug) return;
    window.location.assign(`/s/${slug}`);
  }

  async function handleSignOut() {
    try {
      await signOut();
      // Full reload to /login so any in-memory user state is dropped.
      window.location.assign("/login");
    } catch (e) {
      notifyThrown("Sign out failed", e);
    }
  }

  // Invalidate the cached server list when the menu closes — otherwise a
  // user who creates/leaves a workspace in another tab and returns sees
  // stale entries until a hard nav. Also kick a fetch on open so keyboard
  // opens (Space/Enter on the trigger) get the same data the pointer path
  // gets via onPointerDown — without this the menu stays at "Loading…".
  function handleOpenChange(next: boolean) {
    if (next) {
      ensureLoaded();
    } else {
      loadVersion.current += 1;
      inFlight.current = false;
      setServers(null);
      setDefaultServerId(null);
    }
  }

  // Partition memberships for the grouped view. Owners + admins go under
  // "Your workspaces"; pure members under "Joined". Within each group the
  // server array is already sorted by /me (role rank then joinedAt asc).
  const ownedRows = servers?.filter((s) => s.role === "owner" || s.role === "admin") ?? null;
  const joinedRows = servers?.filter((s) => s.role === "member") ?? null;

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        onPointerDown={ensureLoaded}
        className="group flex w-full items-center gap-2.5 rounded-[9px] border border-border bg-surface/85 px-2 py-1.5 text-left !shadow-none transition-colors hover:border-accent/25 hover:bg-surface focus:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <WorkspaceIcon iconUrl={currentIconUrl} name={currentServerName} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">{currentServerName}</div>
          <div className="truncate text-[11px] text-muted-foreground">/{currentServerSlug}</div>
        </div>
        <span className="sr-only">, switch workspace</span>
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] bg-default text-muted-foreground transition-colors group-hover:text-foreground">
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-(--anchor-width) min-w-72">
        {servers === null ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">Loading…</div>
        ) : servers.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            You&apos;re not a member of any workspace yet.
          </div>
        ) : (
          <>
            {/* Owner / admin group — labelled "Your workspaces" so an
                invitee landing on someone else's workspace can find
                their own one click away. Default workspace gets a star;
                clicking a non-default row's star sets it as default. */}
            {ownedRows && ownedRows.length > 0 && (
              <>
                <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Your workspaces
                </div>
                {ownedRows.map((s) => (
                  <WorkspaceRow
                    key={s.id}
                    s={s}
                    active={s.id === currentServerId}
                    isDefault={s.id === defaultServerId}
                    pendingDefault={pendingDefault === s.id}
                    onClick={() => switchTo(s.slug)}
                    onSetDefault={() => handleSetDefault(s.id)}
                  />
                ))}
              </>
            )}
            {joinedRows && joinedRows.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Joined
                </div>
                {joinedRows.map((s) => (
                  <WorkspaceRow
                    key={s.id}
                    s={s}
                    active={s.id === currentServerId}
                    isDefault={s.id === defaultServerId}
                    pendingDefault={pendingDefault === s.id}
                    onClick={() => switchTo(s.slug)}
                    onSetDefault={() => handleSetDefault(s.id)}
                  />
                ))}
              </>
            )}
          </>
        )}
        <DropdownMenuSeparator />
        {/* "Create workspace" intentionally NOT shown here yet — there
            is no dedicated creation route. The old item linked to `/`,
            but `/` now mounts <SignedInRedirect> which immediately
            sends signed-in users back to their default workspace,
            making the link a no-op loop. Re-introduce when a real
            creation flow ships (settings tab? modal wizard?). */}
        {/* Sign-out duplicated here so users have a discoverable exit
            from the same menu they use to switch accounts/workspaces.
            The Account tab keeps the canonical sign-out + profile
            controls, but burying it 3 clicks deep was a UX regression
            vs. industry norms (Slack/Discord both surface sign-out in
            the workspace switcher). */}
        <DropdownMenuItem onClick={handleSignOut} variant="destructive">
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Workspace dropdown row — switch on click, set-as-default via a
// secondary menu action. Pulling this out keeps the JSX above
// readable when we have two grouped sections rendering the same shape.
function WorkspaceRow({
  s, active, isDefault, pendingDefault, onClick, onSetDefault,
}: {
  s: MeServer;
  active: boolean;
  isDefault: boolean;
  pendingDefault: boolean;
  onClick: () => void;
  onSetDefault: () => void;
}) {
  return (
    <>
      <DropdownMenuItem
        onClick={onClick}
        className={cn(
          "gap-2.5",
          active && "bg-cyan-500/8 text-cyan-700 dark:text-cyan-400",
        )}
      >
        <WorkspaceIcon iconUrl={s.iconUrl} name={s.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{s.name}</div>
          <div className="truncate text-[10.5px] text-muted-foreground">
            /{s.slug}{isDefault ? " · default" : ""}
          </div>
        </div>
        {active && <Check className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-400" aria-hidden="true" />}
        {isDefault && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-amber-500" aria-hidden="true" />}
      </DropdownMenuItem>
      {!isDefault && (
        <DropdownMenuItem
          onClick={onSetDefault}
          disabled={pendingDefault}
          aria-label={`${pendingDefault ? "Setting" : "Set"} ${s.name} as default workspace`}
          className="min-h-7 pl-10 text-xs text-muted-foreground"
        >
          <Star className="h-3.5 w-3.5" aria-hidden="true" />
          {pendingDefault ? "Setting default..." : "Set as default"}
        </DropdownMenuItem>
      )}
    </>
  );
}

// Shared workspace icon — falls back to the brand monogram when no upload.
function WorkspaceIcon({
  iconUrl, name, size,
}: { iconUrl?: string | null; name: string; size: "sm" | "md" }) {
  const dim = size === "md" ? "h-9 w-9" : "h-7 w-7";
  const text = size === "md" ? "text-sm" : "text-xs";
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        className={cn(dim, "rounded-xl object-cover ring-1 ring-white/70 shrink-0 shadow-sm dark:ring-white/10")}
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    );
  }
  return (
    <div
      className={cn(
        dim, text,
        "flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-amber-500 font-semibold text-white shadow-sm",
      )}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || <Building2 className="h-4 w-4" aria-hidden="true" />}
    </div>
  );
}

"use client";

// Workspace switcher primitives. The active workspace no longer occupies the
// sidebar header; that space is reserved for the Raltic brand. The switcher
// UI is rendered inside the bottom settings/account menu via
// WorkspaceMenuSection.
//
// Design constraints:
//   • Reads the workspace list lazily, on first hover/click — most renders
//     are noise and the API hit ($) isn't free on Cloudflare Workers.
//   • Active workspace shown with a check + cyan accent so the dropdown
//     doubles as orientation, not just navigation.
//   • Workspace management actions stay here; account/session actions stay
//     in the bottom UserPill so the two menus do not duplicate scope.

import { useRef, useState, useEffect } from "react";
import { ChevronDown, Check, Building2, Hash, Settings as SettingsIcon, Star, Users } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { notifySuccess, notifyThrown } from "@/lib/notify";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
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
        data-testid="workspace-switcher-trigger"
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
          <DropdownMenuLabel className="py-2 font-normal">Loading…</DropdownMenuLabel>
        ) : servers.length === 0 ? (
          <DropdownMenuLabel className="py-2 font-normal">
            You&apos;re not a member of any workspace yet.
          </DropdownMenuLabel>
        ) : (
          <>
            {/* Owner / admin group — labelled "Your workspaces" so an
                invitee landing on someone else's workspace can find
                their own one click away. Default workspace gets a star;
                clicking a non-default row's star sets it as default. */}
            {ownedRows && ownedRows.length > 0 && (
              <>
                <DropdownMenuLabel className="pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider">
                  Your workspaces
                </DropdownMenuLabel>
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
                <DropdownMenuLabel className="pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider">
                  Joined
                </DropdownMenuLabel>
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
        <DropdownMenuLabel className="pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider">
          Manage workspace
        </DropdownMenuLabel>
        <DropdownMenuItem href={`/s/${currentServerSlug}/settings/workspace`}>
          <SettingsIcon className="h-4 w-4" /> Workspace settings
        </DropdownMenuItem>
        <DropdownMenuItem href={`/s/${currentServerSlug}/settings/members`}>
          <Users className="h-4 w-4" /> Members & invites
        </DropdownMenuItem>
        <DropdownMenuItem href={`/s/${currentServerSlug}/channels`}>
          <Hash className="h-4 w-4" /> Browse channels
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkspaceMenuSection({
  open,
  currentServerId,
  currentServerName,
  currentServerSlug,
  currentIconUrl,
}: {
  open: boolean;
  currentServerId: string;
  currentServerName: string;
  currentServerSlug: string;
  currentIconUrl?: string | null;
}) {
  const [servers, setServers] = useState<MeServer[] | null>(null);
  const [defaultServerId, setDefaultServerId] = useState<string | null>(null);
  const [pendingDefault, setPendingDefault] = useState<string | null>(null);
  const pendingDefaultRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (open) {
      ensureLoaded();
    } else {
      loadVersion.current += 1;
      inFlight.current = false;
      setServers(null);
      setDefaultServerId(null);
    }
    // `ensureLoaded` deliberately stays local to this component; depend
    // only on `open` so closing reliably invalidates the cached list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  function switchTo(slug: string) {
    if (slug === currentServerSlug) return;
    window.location.assign(`/s/${slug}`);
  }

  const otherServers = (servers ?? []).filter((s) => s.id !== currentServerId);
  const ownedRows = otherServers.filter((s) => s.role === "owner" || s.role === "admin");
  const joinedRows = otherServers.filter((s) => s.role === "member");

  return (
    <>
      <DropdownMenuLabel className="pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider">
        Current workspace
      </DropdownMenuLabel>
      <DropdownMenuLabel className="flex min-h-10 items-center gap-2.5 rounded-md px-2 py-1.5 text-foreground">
        <WorkspaceIcon iconUrl={currentIconUrl} name={currentServerName} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">{currentServerName}</span>
          <span className="block truncate text-[10.5px] font-normal text-muted-foreground">/{currentServerSlug}</span>
        </span>
      </DropdownMenuLabel>
      <DropdownMenuItem href={`/s/${currentServerSlug}/settings/workspace`}>
        <SettingsIcon className="h-4 w-4" /> Workspace settings
      </DropdownMenuItem>
      <DropdownMenuItem href={`/s/${currentServerSlug}/settings/members`}>
        <Users className="h-4 w-4" /> Members & invites
      </DropdownMenuItem>
      <DropdownMenuItem href={`/s/${currentServerSlug}/channels`}>
        <Hash className="h-4 w-4" /> Browse channels
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider">
        Switch workspace
      </DropdownMenuLabel>
      {servers === null ? (
        <DropdownMenuLabel className="py-2 font-normal">Loading workspaces…</DropdownMenuLabel>
      ) : otherServers.length === 0 ? (
        <DropdownMenuLabel className="py-2 font-normal">No other workspaces.</DropdownMenuLabel>
      ) : (
        <>
          {ownedRows.map((s) => (
            <WorkspaceRow
              key={s.id}
              s={s}
              active={false}
              isDefault={s.id === defaultServerId}
              pendingDefault={pendingDefault === s.id}
              onClick={() => switchTo(s.slug)}
              onSetDefault={() => handleSetDefault(s.id)}
            />
          ))}
          {ownedRows.length > 0 && joinedRows.length > 0 && <DropdownMenuSeparator />}
          {joinedRows.map((s) => (
            <WorkspaceRow
              key={s.id}
              s={s}
              active={false}
              isDefault={s.id === defaultServerId}
              pendingDefault={pendingDefault === s.id}
              onClick={() => switchTo(s.slug)}
              onSetDefault={() => handleSetDefault(s.id)}
            />
          ))}
        </>
      )}
    </>
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
export function WorkspaceIcon({
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

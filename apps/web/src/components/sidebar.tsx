"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Sidebar as HeroSidebar, useSidebar } from "@heroui-pro/react/sidebar";
import { Sheet } from "@heroui-pro/react/sheet";
import { api, type Channel, type Agent } from "@/lib/api";
import { BellOff, Hash, Lock, MessageSquare, Plus, ListTodo, Inbox as InboxIcon, Cpu, Star, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateChannelDialog } from "./create-channel-dialog";
import { NewDmDialog } from "./new-dm-dialog";
import { Button } from "@/components/heroui-pro/button";
import { useGateway, useChannelUnread, useWorkspacePresence } from "@/hooks/use-agent-activity";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { UserPill } from "./user-pill";

interface SidebarProps {
  serverSlug: string;
  serverId: string;
  serverName: string;
  serverIconUrl?: string | null;
}

export function Sidebar({ serverSlug, serverId, serverName, serverIconUrl }: SidebarProps) {
  const [openCreate, setOpenCreate] = useState(false);
  const [openNewDm, setOpenNewDm] = useState(false);
  const { seedChannel, setMutedChannelIds } = useGateway();
  const params = useParams();
  const pathname = usePathname();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedServerSlug, setLoadedServerSlug] = useState<string | null>(null);
  const activeChannelId = params.channelId as string | undefined;

  // refreshKey bumps trigger a re-fetch from child actions that
  // mutate workspace channels — currently:
  //   - NewDmDialog onOpened (a new DM channel exists after find-or-create)
  //   - Channels browse page join (custom event bubbled up through window)
  // Without these, the sidebar's local channels[] is stale until a hard
  // reload and the just-created channel doesn't appear in the section.
  const [refreshKey, setRefreshKey] = useState(0);
  const reloadChannels = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await api.getServerBySlug(serverSlug);
        const agentData = await api.listAgents().catch(() => null);
        if (cancelled) return;
        setChannels(data.channels);
        setAgents((agentData?.agents ?? data.agents).filter((a) => a.serverId === data.server.id));
        // Phase F HIGH (codex G2) — publish muted channel set to the
        // gateway so the channel_new Notification gate suppresses
        // toasts for channels the user has muted.
        setMutedChannelIds(new Set(
          data.channels.filter((c) => c.mutedAt != null).map((c) => c.id),
        ));
        // Seed gateway with initial unread state so the sidebar can render
        // accurate badges from the first paint.
        for (const c of data.channels) {
          const unread = c.unread ?? 0;
          const maxSeq = c.maxSeq ?? unread;
          const lastReadSeq = c.lastReadSeq ?? Math.max(0, maxSeq - unread);
          seedChannel(c.id, maxSeq, lastReadSeq);
        }
        setLoadedServerSlug(serverSlug);
      } catch {
        if (cancelled) return;
        setChannels([]);
        setAgents([]);
        setMutedChannelIds(new Set());
        setLoadedServerSlug(serverSlug);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [serverSlug, seedChannel, setMutedChannelIds, refreshKey]);

  // Cross-component channel-mutation signal. The Channels browse page
  // dispatches `raltic:channels-changed` on join/leave so the sidebar
  // refreshes without prop drilling a callback through Next's route layer.
  useEffect(() => {
    function onChanged() { reloadChannels(); }
    window.addEventListener("raltic:channels-changed", onChanged);
    return () => window.removeEventListener("raltic:channels-changed", onChanged);
  }, [reloadChannels]);

  // Phase E — within each section, starred channels sort first
  // (most recently starred → least). Non-starred follow in their
  // existing order. Single source of truth so no other component
  // has to re-do the sort.
  const sortStarredFirst = (a: Channel, b: Channel) => {
    const aS = a.starredAt ?? 0;
    const bS = b.starredAt ?? 0;
    if (aS !== bS) return bS - aS;
    return 0; // preserve original order otherwise
  };
  const publicChannels = channels.filter((c) => c.type === "public").sort(sortStarredFirst);
  const dmChannels = channels.filter((c) => c.type === "dm").sort(sortStarredFirst);
  const privateChannels = channels.filter((c) => c.type === "private").sort(sortStarredFirst);
  const existingDmPeers = new Set<string>([
    ...dmChannels.flatMap((c) => c.peer ? [`${c.peer.type}:${c.peer.id}`] : []),
    ...agents.filter((a) => a.dmChannelId).map((a) => `agent:${a.id}`),
  ]);
  const isLoading = loading || loadedServerSlug !== serverSlug;
  const { isMobile, isMobileOpen, setMobileOpen } = useSidebar();

  function openCreateDialog() {
    if (isMobile) setMobileOpen(false);
    setOpenCreate(true);
  }

  function openNewDmDialog() {
    if (isMobile) setMobileOpen(false);
    setOpenNewDm(true);
  }

  const sidebarContent = () => (
    <>
      <HeroSidebar.Header className="!flex-row !items-center !gap-2 !px-4 !pb-3 !pt-4">
        <div className="flex-1 min-w-0">
          <WorkspaceSwitcher
            currentServerId={serverId}
            currentServerName={serverName}
            currentServerSlug={serverSlug}
            currentIconUrl={serverIconUrl}
          />
        </div>
        <Button
          type="button"
          onClick={openCreateDialog}
          variant="outline"
          size="icon-sm"
          className="h-9 w-9 shrink-0 rounded-full text-muted-foreground"
          title="New channel"
          aria-label="Create channel"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </HeroSidebar.Header>

      <HeroSidebar.Content
        data-testid="workspace-sidebar-scroll"
        className="!min-h-0 !flex-1 !gap-0 !px-4 !pb-3 !pt-0 text-sm"
      >
        <nav aria-label="Workspace navigation" className="text-sm">
          {isLoading ? (
            <p className="rounded-xl border border-border bg-default px-3 py-2 text-xs text-muted-foreground">Loading...</p>
          ) : (
            <>
              {/* Top-level destination — sibling of Channels / DMs / Agents,
                  rendered as a single row (no section header) since there's
                  only one item under "Tasks". */}
              <HeroSidebar.Menu className="space-y-1" aria-label="Workspace destinations">
                <TopLevelLink
                  href={`/s/${serverSlug}/inbox`}
                  icon={<InboxIcon className="h-4 w-4" />}
                  label="Inbox"
                  active={pathname === `/s/${serverSlug}/inbox`}
                />
                <TopLevelLink
                  href={`/s/${serverSlug}/tasks`}
                  icon={<ListTodo className="h-4 w-4" />}
                  label="Tasks"
                  active={pathname === `/s/${serverSlug}/tasks`}
                />
                <TopLevelLink
                  href={`/s/${serverSlug}/agents`}
                  icon={<Cpu className="h-4 w-4" />}
                  label="Agents"
                  active={pathname === `/s/${serverSlug}/agents` || pathname.startsWith(`/s/${serverSlug}/agents/`)}
                />
                <TopLevelLink
                  href={`/s/${serverSlug}/people`}
                  icon={<Users className="h-4 w-4" />}
                  label="People"
                  active={pathname === `/s/${serverSlug}/people` || pathname.startsWith(`/s/${serverSlug}/people/`)}
                />
              </HeroSidebar.Menu>
              <ChannelGroup
                label="Channels"
                icon={<Hash className="h-3.5 w-3.5" />}
                channels={publicChannels}
                activeId={activeChannelId}
                serverSlug={serverSlug}
                serverId={serverId}
                // "+" reveals on group hover (same pattern as Direct
                // messages). Click → workspace's create-channel dialog if
                // admin, else routes to /s/{slug}/channels for browse +
                // join. Keeps the discovery path visible without taking
                // permanent sidebar real estate.
                headerAction={
                  <Link
                    href={`/s/${serverSlug}/channels`}
                    className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-all group-hover/group:opacity-100 hover:bg-default hover:text-foreground focus-visible:opacity-100"
                    title="Browse all channels"
                    aria-label="Browse all public channels"
                  >
                    <Hash className="h-3 w-3" />
                  </Link>
                }
              />
              <ChannelGroup
                label="Direct messages"
                icon={<MessageSquare className="h-3.5 w-3.5" />}
                channels={dmChannels}
                activeId={activeChannelId}
                serverSlug={serverSlug}
                serverId={serverId}
                // "+" reveals on group hover (group/group class on
                // SidebarGroup wrapper). Click opens the new-DM picker
                // covering both humans + agents — the discoverable entry
                // point for starting a DM with someone NOT yet in the
                // sidebar list (an invitee, a newly-created agent, etc.).
                headerAction={
                  <Button
                    type="button"
                    onClick={openNewDmDialog}
                    variant="ghost"
                    size="icon-xs"
                    className="ml-1 h-5 w-5 text-muted-foreground/60 opacity-0 transition-all group-hover/group:opacity-100 focus-visible:opacity-100"
                    title="Start a new direct message"
                    aria-label="Start a new direct message"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                }
                // Render the empty-state row so the "+" stays discoverable
                // for a brand-new workspace user who has zero DMs yet.
                emptyHint={
                  <p className="rounded-xl border border-dashed border-border bg-default px-3 py-2 text-[11px] text-muted-foreground">
                    No conversations yet. Tap <span className="font-mono">+</span> to start one.
                  </p>
                }
              />
              {privateChannels.length > 0 && (
                <ChannelGroup label="Private" icon={<Lock className="h-3.5 w-3.5" />}
                  channels={privateChannels} activeId={activeChannelId} serverSlug={serverSlug} serverId={serverId} />
              )}
            </>
          )}
        </nav>
      </HeroSidebar.Content>

      {/* Footer: identity-only.
          - bottom-left: UserPill (avatar + name + visible "Online"
            status line + chevron). Click → account / workspace settings
            / sign out dropdown.
          - We used to ship a separate ⚙ shortcut here that duplicated
            the dropdown's "Workspace settings" item — removed per
            user feedback ("两个入口去同一个地方，多余"). Workspace
            settings is still reachable via the dropdown menu (and
            via URL: /s/{slug}/settings/workspace).
          - Workspace presence is real (useWorkspacePresence hook is
            wired); the inline "Online" label reflects the fact that
            other teammates see you as online when this tab is open. */}
      <HeroSidebar.Footer className="!gap-0 border-t border-sidebar-border bg-sidebar !px-4 !py-3">
        <UserPill serverSlug={serverSlug} />
      </HeroSidebar.Footer>
    </>
  );

  return (
    <>
      {!isMobile && (
        <HeroSidebar.Root
          data-testid="workspace-sidebar"
          className="!sticky !top-0 !min-h-0 !border-r !border-sidebar-border !bg-sidebar"
          style={{
            "--sidebar-width": "15rem",
            "--sidebar-width-collapsed": "15rem",
            height: "var(--raltic-visual-viewport-height)",
          } as CSSProperties}
        >
          {sidebarContent()}
        </HeroSidebar.Root>
      )}
      {isMobile && (
        <Sheet.Root isOpen={isMobileOpen} placement="left" onOpenChange={setMobileOpen}>
          <Sheet.Backdrop variant="blur">
            <Sheet.Content className="sidebar__mobile-sheet">
              <Sheet.Dialog className="sidebar__mobile-dialog">
                <Sheet.Heading className="sr-only">Workspace navigation</Sheet.Heading>
                <div
                  data-testid="workspace-sidebar-mobile"
                  data-slot="sidebar-mobile"
                  aria-label="Workspace navigation"
                  className="sidebar__mobile raltic-workspace-mobile-sidebar !h-[var(--raltic-visual-viewport-height)] !max-h-[var(--raltic-visual-viewport-height)] !bg-sidebar"
                >
                  {sidebarContent()}
                </div>
              </Sheet.Dialog>
            </Sheet.Content>
          </Sheet.Backdrop>
        </Sheet.Root>
      )}

      <CreateChannelDialog
        serverId={serverId}
        open={openCreate}
        onOpenChange={setOpenCreate}
        onCreated={() => location.reload()}
      />
      {/* DM picker. Existing peers come from DM channel peer metadata so
          the "in DMs" hint is consistent for humans and agents. Agent
          dmChannelId stays as a fallback for older API payloads. */}
      <NewDmDialog
        serverId={serverId}
        serverSlug={serverSlug}
        existingDmPeers={existingDmPeers}
        open={openNewDm}
        onOpenChange={setOpenNewDm}
        onOpened={reloadChannels}
      />
    </>
  );
}

// ── Building blocks (one source of truth for sidebar row rhythm) ──

const SIDEBAR_ITEM_CLASS =
  "!rounded-xl !outline-none";

const SIDEBAR_LINK_CLASS =
  "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-xl px-3 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[current=true]:bg-sidebar-primary data-[current=true]:text-sidebar-primary-foreground data-[current=true]:shadow-sm";

/** Map each section name to a brand-tinted dot — visual rhythm that says
 *  "this is Raltic" without printing the logo on every group label. */
const GROUP_DOT: Record<string, string> = {
  Channels: "bg-cyan-500/70",
  "Direct messages": "bg-amber-500/70",
  Private: "bg-violet-500/70",
  Agents: "bg-gradient-to-br from-cyan-500 to-amber-500",
};

function SidebarGroup({
  label, children, headerAction,
}: {
  label: string;
  children: React.ReactNode;
  // Optional trailing button in the section header (e.g. "+" to start a
  // new DM). Stays subtle until hovered so it doesn't compete with the
  // section title.
  headerAction?: React.ReactNode;
}) {
  const dot = GROUP_DOT[label] ?? "bg-muted-foreground/40";
  return (
    <HeroSidebar.Group className="group/group mt-5 !gap-1.5 first:mt-0">
      <HeroSidebar.GroupLabel className="!flex !items-center !gap-1.5 !px-2 !py-1 text-[10.5px] font-medium uppercase text-muted-foreground/80">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
        <span className="flex-1">{label}</span>
        {headerAction}
      </HeroSidebar.GroupLabel>
      {children}
    </HeroSidebar.Group>
  );
}

/** Sibling of section labels — a single nav destination like Tasks or
 *  Threads that lives at the same hierarchy as Channels / DMs / Agents
 *  but doesn't expand into a list. Uses the same row rhythm as channel
 *  rows so the cyan accent + hover treatment match. */
function TopLevelLink({ href, icon, label, active }: {
  href: string; icon: React.ReactNode; label: string; active: boolean;
}) {
  const { isMobile, setMobileOpen } = useSidebar();

  return (
    <HeroSidebar.MenuItem
      id={href}
      isCurrent={active}
      textValue={label}
      className={cn(
        SIDEBAR_ITEM_CLASS,
      )}
    >
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        data-current={active ? "true" : undefined}
        className={cn(SIDEBAR_LINK_CLASS, "font-medium")}
        onClick={() => {
          if (isMobile) setMobileOpen(false);
        }}
      >
        <HeroSidebar.MenuIcon className="shrink-0 text-current">{icon}</HeroSidebar.MenuIcon>
        <HeroSidebar.MenuLabel className="min-w-0 flex-1 truncate !text-current [&_[data-slot=sidebar-menu-label-text]]:!text-current">{label}</HeroSidebar.MenuLabel>
      </Link>
    </HeroSidebar.MenuItem>
  );
}

function ChannelLink({ channel, activeId, serverSlug, serverId, icon }: {
  channel: Channel; activeId?: string; serverSlug: string; serverId: string; icon: React.ReactNode;
}) {
  const live = useChannelUnread(channel.id);
  const liveUnread = activeId === channel.id ? 0 : live;
  const isActive = activeId === channel.id;
  // Phase A — mute respects: suppress unread badge AND bold weight so
  // muted channels stay visible but don't fight for attention. The
  // count is still computed (we want @-mentions logic later to bypass
  // mute) but the visual treatment hides the noise.
  const isMuted = channel.mutedAt != null;
  const unread = isMuted ? 0 : liveUnread;
  // Workspace presence — only for human DM rows. The hook is refcounted
  // and shares a single WS subscription across all callers in the tree.
  const presence = useWorkspacePresence(serverId);
  const humanPeerPresence =
    channel.type === "dm" && channel.peer?.type === "human"
      ? presence[channel.peer.id]
      : undefined;
  // DM rows show the OTHER party's name, not channel.name (which for
  // human↔human DMs is a hex slug, never a person's name). Falls back
  // to channel.name if peer wasn't populated (older API, or non-DM).
  const displayName =
    channel.type === "dm" && channel.peer?.name
      ? channel.peer.name
      : channel.name;
  const href = `/s/${serverSlug}/${channel.type === "dm" ? "dm" : "channel"}/${channel.id}`;
  const { isMobile, setMobileOpen } = useSidebar();

  return (
    <HeroSidebar.MenuItem
      id={channel.id}
      isCurrent={isActive}
      textValue={displayName}
      className={cn(
        SIDEBAR_ITEM_CLASS,
        unread > 0 && "font-semibold",
        // Phase A — muted: switch to muted-foreground tint instead of
        // opacity-60 (codex PA2 MED — opacity dropped contrast below
        // AA 4.5:1). The semantic token keeps AA contrast in both
        // light + dark modes. Active state overrides so the user can
        // still see clearly which muted channel they're viewing.
        isMuted && !isActive && "text-muted-foreground",
      )}
    >
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        data-current={isActive ? "true" : undefined}
        className={cn(
          SIDEBAR_LINK_CLASS,
          unread > 0 && "font-semibold",
          isMuted && !isActive && "text-muted-foreground",
        )}
        onClick={() => {
          if (isMobile) setMobileOpen(false);
        }}
      >
        <HeroSidebar.MenuIcon className="shrink-0 text-current">{icon}</HeroSidebar.MenuIcon>
        <HeroSidebar.MenuLabel className="min-w-0 flex-1 truncate !text-current [&_[data-slot=sidebar-menu-label-text]]:!text-current">{displayName}</HeroSidebar.MenuLabel>
        {channel.type !== "dm" && channel.starredAt != null && (
          <Star className="h-3 w-3 shrink-0 fill-current text-amber-500" aria-label="Starred" />
        )}
        {channel.type !== "dm" && isMuted && (
          <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Muted" />
        )}
        {/* For human DMs: emerald dot if peer's online, zinc dot if seen
            recently, none if never connected. Real workspace presence —
            not the hardcoded green the user-pill used to show. */}
        {humanPeerPresence !== undefined && (
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              humanPeerPresence.online
                ? "bg-success shadow-[0_0_5px_rgba(16,185,129,0.55)]"
                : "bg-zinc-400/60",
            )}
            aria-label={humanPeerPresence.online ? "Online" : "Offline"}
          />
        )}
        {/* For agent DMs, show the runtime indicator inline so users can
            tell at a glance whether a DM peer is Claude or Codex without
            opening the channel. Humans show no chip. */}
        {channel.type === "dm" && channel.peer?.type === "agent" && channel.peer.runtime && (
          <RuntimeDot runtime={channel.peer.runtime} />
        )}
        {unread > 0 && (
          <HeroSidebar.MenuChip
            className={cn(
              "min-w-5 justify-center text-[10px]",
              isActive
                ? "!bg-sidebar-primary-foreground !text-sidebar-primary"
                : "!bg-sidebar-primary !text-sidebar-primary-foreground",
            )}
          >
            {unread > 99 ? "99+" : unread}
          </HeroSidebar.MenuChip>
        )}
      </Link>
    </HeroSidebar.MenuItem>
  );
}

function ChannelGroup({
  label, icon, channels, activeId, serverSlug, serverId, headerAction, emptyHint,
}: {
  label: string;
  icon: React.ReactNode;
  channels: Channel[];
  activeId?: string;
  serverSlug: string;
  /** Required — ChannelLink uses it to look up workspace presence for
   *  human DM peers. */
  serverId: string;
  // Optional "+" or similar trailing action shown in the section header.
  headerAction?: React.ReactNode;
  // Optional copy shown when there are zero channels in this group, IF
  // we want the group to render at all. Without this, the group hides
  // (the legacy behavior — channels.length === 0 returns null below).
  emptyHint?: React.ReactNode;
}) {
  if (channels.length === 0 && !emptyHint) return null;
  return (
    <SidebarGroup label={label} headerAction={headerAction}>
      {channels.length === 0 && emptyHint ? (
        emptyHint
      ) : (
        <HeroSidebar.Menu className="space-y-1" aria-label={label}>
          {channels.map((c) => (
            <ChannelLink key={c.id} channel={c} activeId={activeId} serverSlug={serverSlug} serverId={serverId} icon={icon} />
          ))}
        </HeroSidebar.Menu>
      )}
    </SidebarGroup>
  );
}

/** Tiny runtime indicator next to the agent name. Color + letter glyph
 *  (not color-only) so it remains distinguishable for color-blind users
 *  and at WCAG-AA contrast on small sizes. Cyan square=Claude, amber
 *  circle=Codex; the differing SHAPE is the redundant non-color cue. */
function RuntimeDot({ runtime }: { runtime: string }) {
  // Accept `string` so a legacy "gemini"/"copilot" value from the DB
  // doesn't crash with palette.bg on undefined. Falls through to a
  // neutral zinc dot. Detected by review (backcompat H1).
  const palette: Record<string, { bg: string; text: string; shape: string; label: string }> = {
    claude:   { bg: "bg-cyan-500",   text: "C", shape: "rounded-sm",   label: "Claude" },
    codex:    { bg: "bg-amber-500",  text: "X", shape: "rounded-full", label: "Codex" },
    openclaw: { bg: "bg-violet-500", text: "O", shape: "rounded-md",   label: "OpenClaw" },
    hermes:   { bg: "bg-rose-500",   text: "H", shape: "rounded-sm",   label: "Hermes" },
  };
  const entry = palette[runtime] ?? { bg: "bg-zinc-400", text: "?", shape: "rounded-sm", label: runtime || "Unknown runtime" };
  return (
    <span
      title={entry.label}
      aria-label={`Runtime: ${entry.label}`}
      className={`inline-flex h-3 w-3 shrink-0 items-center justify-center ${entry.shape} ${entry.bg} text-[8px] font-bold leading-none text-white`}
    >
      {entry.text}
    </span>
  );
}

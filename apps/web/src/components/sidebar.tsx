"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { api, type Channel, type Agent } from "@/lib/api";
import { Hash, Lock, MessageSquare, Settings, Plus, ListTodo, Inbox as InboxIcon, Cpu, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateChannelDialog } from "./create-channel-dialog";
import { NewDmDialog } from "./new-dm-dialog";
import { useAgentActivities, useGateway, useChannelUnread } from "@/hooks/use-agent-activity";
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
  const activities = useAgentActivities();
  const { seedChannel } = useGateway();
  const params = useParams();
  const pathname = usePathname();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const activeChannelId = params.channelId as string | undefined;
  const activeAgentId = params.agentId as string | undefined;

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
        // Seed gateway with initial unread state so the sidebar can render
        // accurate badges from the first paint.
        for (const c of data.channels) {
          const unread = c.unread ?? 0;
          const maxSeq = c.maxSeq ?? unread;
          const lastReadSeq = c.lastReadSeq ?? Math.max(0, maxSeq - unread);
          seedChannel(c.id, maxSeq, lastReadSeq);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [serverSlug, seedChannel, refreshKey]);

  // Cross-component channel-mutation signal. The Channels browse page
  // dispatches `raltic:channels-changed` on join/leave so the sidebar
  // refreshes without prop drilling a callback through Next's route layer.
  useEffect(() => {
    function onChanged() { reloadChannels(); }
    window.addEventListener("raltic:channels-changed", onChanged);
    return () => window.removeEventListener("raltic:channels-changed", onChanged);
  }, [reloadChannels]);

  const publicChannels = channels.filter((c) => c.type === "public");
  const dmChannels = channels.filter((c) => c.type === "dm");
  const privateChannels = channels.filter((c) => c.type === "private");

  return (
    <aside className="flex w-64 shrink-0 flex-col">
      <div className="flex items-center gap-1 px-2 pt-2 pb-2">
        <div className="flex-1 min-w-0">
          <WorkspaceSwitcher
            currentServerId={serverId}
            currentServerName={serverName}
            currentServerSlug={serverSlug}
            currentIconUrl={serverIconUrl}
          />
        </div>
        <button
          onClick={() => setOpenCreate(true)}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="New channel"
          aria-label="Create channel"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2 text-sm">
        {loading ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            {/* Top-level destination — sibling of Channels / DMs / Agents,
                rendered as a single row (no section header) since there's
                only one item under "Tasks". */}
            <ul className="space-y-0.5">
              <li>
                <TopLevelLink
                  href={`/s/${serverSlug}/inbox`}
                  icon={<InboxIcon className="h-4 w-4" />}
                  label="Inbox"
                  active={pathname === `/s/${serverSlug}/inbox`}
                />
              </li>
              <li>
                <TopLevelLink
                  href={`/s/${serverSlug}/tasks`}
                  icon={<ListTodo className="h-4 w-4" />}
                  label="Tasks"
                  // Exact match — `endsWith("/tasks")` would light up
                  // any future sub-route or a literally-named channel.
                  active={pathname === `/s/${serverSlug}/tasks`}
                />
              </li>
              <li>
                {/* Agents promoted to top-level destination — used to be
                    a separate sidebar SECTION listing every agent inline.
                    Problem: each agent has an auto-created DM channel
                    (channels.type='dm'), so the same agent showed up TWICE
                    in the sidebar — once under Direct messages (chat),
                    once under Agents (profile). Two parallel lists of the
                    same entity is confusing. Now Direct messages stays
                    (hot path = chat) and the dedicated browse + profile
                    surface lives at /s/{slug}/agents. */}
                <TopLevelLink
                  href={`/s/${serverSlug}/agents`}
                  icon={<Cpu className="h-4 w-4" />}
                  label="Agents"
                  // Light up for both the index page and any agent
                  // profile sub-page so the user knows which top-level
                  // destination they're inside.
                  active={pathname === `/s/${serverSlug}/agents` || pathname.startsWith(`/s/${serverSlug}/agents/`)}
                />
              </li>
              <li>
                {/* People = workspace HUMAN members directory. Without
                    this, an invitee couldn't see who else is in the
                    workspace or DM them. Pairs with the (new) human↔
                    human DM find-or-create flow under "Direct messages
                    [+]". */}
                <TopLevelLink
                  href={`/s/${serverSlug}/people`}
                  icon={<Users className="h-4 w-4" />}
                  label="People"
                  active={pathname === `/s/${serverSlug}/people` || pathname.startsWith(`/s/${serverSlug}/people/`)}
                />
              </li>
            </ul>
            <ChannelGroup
              label="Channels"
              icon={<Hash className="h-3.5 w-3.5" />}
              channels={publicChannels}
              activeId={activeChannelId}
              serverSlug={serverSlug}
              // "+" reveals on group hover (same pattern as Direct
              // messages). Click → workspace's create-channel dialog if
              // admin, else routes to /s/{slug}/channels for browse +
              // join. Keeps the discovery path visible without taking
              // permanent sidebar real estate.
              headerAction={
                <Link
                  href={`/s/${serverSlug}/channels`}
                  className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-all group-hover/group:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
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
              // "+" reveals on group hover (group/group class on
              // SidebarGroup wrapper). Click opens the new-DM picker
              // covering both humans + agents — the discoverable entry
              // point for starting a DM with someone NOT yet in the
              // sidebar list (an invitee, a newly-created agent, etc.).
              headerAction={
                <button
                  type="button"
                  onClick={() => setOpenNewDm(true)}
                  className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-all group-hover/group:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
                  title="Start a new direct message"
                  aria-label="Start a new direct message"
                >
                  <Plus className="h-3 w-3" />
                </button>
              }
              // Render the empty-state row so the "+" stays discoverable
              // for a brand-new workspace user who has zero DMs yet.
              emptyHint={
                <p className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  No conversations yet. Tap <span className="font-mono">+</span> to start one.
                </p>
              }
            />
            {privateChannels.length > 0 && (
              <ChannelGroup label="Private" icon={<Lock className="h-3.5 w-3.5" />}
                channels={privateChannels} activeId={activeChannelId} serverSlug={serverSlug} />
            )}
          </>
        )}
      </nav>

      {/* Footer:
          • bottom-left: user identity pill (Slack/Discord pattern —
            who am I right now). Click → Account / Workspace settings /
            Sign out. Status dot stays static green for now; presence
            tracking is a Phase 3 thing.
          • bottom-right: Settings shortcut (gear) — same destination as
            user-pill's "Workspace settings" item but one click away. */}
      <div className="flex items-center gap-1 border-t px-2 py-2">
        <div className="min-w-0 flex-1">
          <UserPill serverSlug={serverSlug} />
        </div>
        <Link
          href={`/s/${serverSlug}/settings/workspace`}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Workspace settings"
          title="Workspace settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </Link>
      </div>

      <CreateChannelDialog
        serverId={serverId}
        open={openCreate}
        onOpenChange={setOpenCreate}
        onCreated={() => location.reload()}
      />
      {/* DM picker. existingDmPeers seeded from agents that already have
          a DM (`dmChannelId` set) — the agent set is reliable + fast.
          Human-human existing DM detection would require a per-channel
          members fetch, which we skip for v1; existing human DMs still
          open (find-or-create is idempotent), just without the "in DMs"
          hint chip. */}
      <NewDmDialog
        serverId={serverId}
        serverSlug={serverSlug}
        existingDmChannelIds={new Set(dmChannels.map((c) => c.id))}
        existingDmPeers={new Set(
          agents.filter((a) => a.dmChannelId).map((a) => `agent:${a.id}`),
        )}
        open={openNewDm}
        onOpenChange={setOpenNewDm}
        onOpened={reloadChannels}
      />
    </aside>
  );
}

// ── Building blocks (one source of truth for sidebar row rhythm) ──

const ROW_BASE =
  "group relative flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors";
const ROW_HOVER = "hover:bg-accent";
// Active state: cyan accent bar + soft tinted bg + a subtle glow on the
// bar itself. The glow is what makes this feel like our app, not just
// shadcn defaults.
const ROW_ACTIVE =
  "bg-gradient-to-r from-cyan-500/10 to-cyan-500/[0.03] text-cyan-700 dark:text-cyan-400 " +
  "before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-cyan-500 " +
  "before:shadow-[0_0_10px_rgba(6,182,212,0.55)]";

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
    <div className="group/group mt-5 first:mt-0">
      <div className="flex items-center gap-1.5 px-2 pb-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
        <span className="flex-1">{label}</span>
        {headerAction}
      </div>
      <ul className="space-y-0.5">
        {Array.isArray(children)
          ? children.map((c, i) => <li key={i}>{c}</li>)
          : <li>{children}</li>}
      </ul>
    </div>
  );
}

/** Sibling of section labels — a single nav destination like Tasks or
 *  Threads that lives at the same hierarchy as Channels / DMs / Agents
 *  but doesn't expand into a list. Uses the same row rhythm as channel
 *  rows so the cyan accent + hover treatment match. */
function TopLevelLink({ href, icon, label, active }: {
  href: string; icon: React.ReactNode; label: string; active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        ROW_BASE,
        "font-medium",
        !active && ROW_HOVER,
        active && ROW_ACTIVE,
      )}
    >
      {/* Icon takes the row's active color when selected so the active
          state reads as a single intent, not a half-tinted row. */}
      <span className={active ? undefined : "text-muted-foreground"}>{icon}</span>
      <span className="flex-1 truncate leading-tight">{label}</span>
    </Link>
  );
}

function SidebarFooterLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href}
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
      {icon} {children}
    </Link>
  );
}

function AgentRow({ agent: a, activity: act, serverSlug, active }: {
  agent: Agent; activity: { status?: string; label?: string } | undefined;
  serverSlug: string; active: boolean;
}) {
  return (
    <div className={cn(ROW_BASE, "p-0", active && ROW_ACTIVE)}>
      {/* Click the row → agent profile (status, history, edit). DM is a
          dedicated icon button — clicking the name shouldn't drop you
          straight into a chat without context. */}
      <Link
        href={`/s/${serverSlug}/agents/${a.id}`}
        className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5", !active && ROW_HOVER)}
        title={`${a.displayName} — view profile`}
      >
        <span className={cn("h-2 w-2 shrink-0 rounded-full",
          act?.status === "thinking" ? "bg-violet-500 animate-pulse" :
          act?.status === "working"  ? "bg-blue-500 animate-pulse" :
          act?.status === "error"    ? "bg-red-500" :
          a.status === "online"      ? "bg-emerald-500" :
          a.status === "sleeping"    ? "bg-amber-500" : "bg-zinc-400")} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate leading-tight">{a.displayName}</span>
            <RuntimeDot runtime={a.runtime} />
          </div>
          {act?.label && <span className="truncate text-[10px] leading-tight text-muted-foreground">{act.label}</span>}
        </div>
      </Link>
      {a.dmChannelId && (
        <Link
          href={`/s/${serverSlug}/dm/${a.dmChannelId}`}
          // focus-visible:opacity-100 keeps keyboard users from chasing
          // an invisible-but-tabbable button.
          className="mr-1.5 shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
          title={`Open DM with ${a.displayName}`}
          aria-label={`Open DM with ${a.displayName}`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

function ChannelLink({ channel, activeId, serverSlug, icon }: {
  channel: Channel; activeId?: string; serverSlug: string; icon: React.ReactNode;
}) {
  const live = useChannelUnread(channel.id);
  const unread = activeId === channel.id ? 0 : live;
  const isActive = activeId === channel.id;
  // DM rows show the OTHER party's name, not channel.name (which for
  // human↔human DMs is a hex slug, never a person's name). Falls back
  // to channel.name if peer wasn't populated (older API, or non-DM).
  const displayName =
    channel.type === "dm" && channel.peer?.name
      ? channel.peer.name
      : channel.name;
  return (
    <Link
      href={`/s/${serverSlug}/${channel.type === "dm" ? "dm" : "channel"}/${channel.id}`}
      className={cn(
        ROW_BASE,
        !isActive && ROW_HOVER,
        // Active channel uses brand cyan accent (left bar + tinted bg) so the
        // sidebar carries brand color, not the old neutral sand-3.
        isActive && ROW_ACTIVE,
        unread > 0 && "font-semibold",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate leading-tight">{displayName}</span>
      {/* For agent DMs, show the runtime indicator inline so users can
          tell at a glance whether a DM peer is Claude or Codex without
          opening the channel. Humans show no chip. */}
      {channel.type === "dm" && channel.peer?.type === "agent" && channel.peer.runtime && (
        <RuntimeDot runtime={channel.peer.runtime} />
      )}
      {unread > 0 && (
        <span className="rounded-full bg-cyan-600 px-1.5 text-[10px] font-medium leading-tight text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

function ChannelGroup({
  label, icon, channels, activeId, serverSlug, headerAction, emptyHint,
}: {
  label: string;
  icon: React.ReactNode;
  channels: Channel[];
  activeId?: string;
  serverSlug: string;
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
        channels.map((c) => (
          <ChannelLink key={c.id} channel={c} activeId={activeId} serverSlug={serverSlug} icon={icon} />
        ))
      )}
    </SidebarGroup>
  );
}

/** Tiny runtime indicator next to the agent name. Color + letter glyph
 *  (not color-only) so it remains distinguishable for color-blind users
 *  and at WCAG-AA contrast on small sizes. Cyan square=Claude, amber
 *  circle=Codex; the differing SHAPE is the redundant non-color cue. */
function RuntimeDot({ runtime }: { runtime: import("@/lib/api").RuntimeId }) {
  // Color + glyph + shape ALL differ across runtimes — the redundancy
  // is intentional for colorblind users at this small (3×3) size.
  const palette = {
    claude:   { bg: "bg-cyan-500",   text: "C", shape: "rounded-sm",   label: "Claude" },
    codex:    { bg: "bg-amber-500",  text: "X", shape: "rounded-full", label: "Codex" },
    openclaw: { bg: "bg-violet-500", text: "O", shape: "rounded-md",   label: "OpenClaw" },
    hermes:   { bg: "bg-rose-500",   text: "H", shape: "rounded-sm",   label: "Hermes" },
  }[runtime];
  return (
    <span
      title={palette.label}
      aria-label={`Runtime: ${palette.label}`}
      className={`inline-flex h-3 w-3 shrink-0 items-center justify-center ${palette.shape} ${palette.bg} text-[8px] font-bold leading-none text-white`}
    >
      {palette.text}
    </span>
  );
}

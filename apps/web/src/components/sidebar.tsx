"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { api, type Channel, type Agent } from "@/lib/api";
import { Hash, Lock, MessageSquare, Settings, LogOut, Plus, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateChannelDialog } from "./create-channel-dialog";
import { useAgentActivities, useGateway, useChannelUnread } from "@/hooks/use-agent-activity";

interface SidebarProps {
  serverSlug: string;
  serverId: string;
  serverName: string;
}

export function Sidebar({ serverSlug, serverId, serverName }: SidebarProps) {
  const [openCreate, setOpenCreate] = useState(false);
  const activities = useAgentActivities();
  const { seedChannel } = useGateway();
  const params = useParams();
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const activeChannelId = params.channelId as string | undefined;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.getServerBySlug(serverSlug);
        if (cancelled) return;
        setChannels(data.channels);
        setAgents(data.agents);
        // Seed gateway with initial unread state so the sidebar can render
        // accurate badges from the first paint.
        for (const c of data.channels) {
          const unread = c.unread ?? 0;
          // We don't know maxSeq directly — synthesize from unread + lastReadSeq.
          // Server returned unread = max - lastRead, so:
          //   maxSeq = lastReadSeq + unread,  lastReadSeq = maxSeq - unread
          // Without knowing either independently, seed both at "lastReadSeq=0,
          // maxSeq=unread" — sidebar shows the right count, then live events
          // refine the absolute numbers.
          seedChannel(c.id, unread, 0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [serverSlug, seedChannel]);

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  const publicChannels = channels.filter((c) => c.type === "public");
  const dmChannels = channels.filter((c) => c.type === "dm");
  const privateChannels = channels.filter((c) => c.type === "private");

  return (
    <aside className="flex w-64 flex-col gap-2 px-2">
      <div className="flex items-start justify-between px-2 pt-3 pb-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{serverName}</h2>
          <p className="text-xs text-muted-foreground">/{serverSlug}</p>
        </div>
        <button
          onClick={() => setOpenCreate(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="New channel"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-1 text-sm">
        {loading ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            <ChannelGroup label="Channels" icon={<Hash className="h-3.5 w-3.5" />}
              channels={publicChannels} activeId={activeChannelId} serverSlug={serverSlug} />
            <ChannelGroup label="Direct messages" icon={<MessageSquare className="h-3.5 w-3.5" />}
              channels={dmChannels} activeId={activeChannelId} serverSlug={serverSlug} />
            {privateChannels.length > 0 && (
              <ChannelGroup label="Private" icon={<Lock className="h-3.5 w-3.5" />}
                channels={privateChannels} activeId={activeChannelId} serverSlug={serverSlug} />
            )}
            <div className="mt-4 px-2 text-xs uppercase tracking-wider text-muted-foreground">Agents</div>
            {agents.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">No agents yet</p>
            )}
            {agents.map((a) => {
              const act = activities[a.id];
              return (
                <div key={a.id} className="flex items-center gap-2 px-2 py-1 text-sm">
                  <span className={cn("h-2 w-2 rounded-full",
                    act?.status === "thinking" ? "bg-violet-500 animate-pulse" :
                    act?.status === "working"  ? "bg-blue-500 animate-pulse" :
                    act?.status === "error"    ? "bg-red-500" :
                    a.status === "online"      ? "bg-emerald-500" :
                    a.status === "sleeping"    ? "bg-amber-500" : "bg-zinc-400")} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{a.displayName}</span>
                    {act?.label && <span className="truncate text-[10px] text-muted-foreground">{act.label}</span>}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </nav>

      <div className="flex items-center justify-between border-t pt-2">
        <div className="flex gap-2">
          <Link href={`/s/${serverSlug}/tasks`} className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
            <ListTodo className="h-3.5 w-3.5" /> Tasks
          </Link>
          <Link href={`/s/${serverSlug}/settings`} className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
            <Settings className="h-3.5 w-3.5" /> Settings
          </Link>
        </div>
        <button onClick={handleSignOut}
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>

      <CreateChannelDialog
        serverId={serverId}
        open={openCreate}
        onOpenChange={setOpenCreate}
        onCreated={() => location.reload()}
      />
    </aside>
  );
}

function ChannelLink({ channel, activeId, serverSlug, icon }: {
  channel: Channel; activeId?: string; serverSlug: string; icon: React.ReactNode;
}) {
  const live = useChannelUnread(channel.id);
  const unread = activeId === channel.id ? 0 : live;
  return (
    <Link
      href={`/s/${serverSlug}/${channel.type === "dm" ? "dm" : "channel"}/${channel.id}`}
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1 hover:bg-accent",
        activeId === channel.id && "bg-accent",
        unread > 0 && "font-semibold",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{channel.name}</span>
      {unread > 0 && (
        <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-medium text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

function ChannelGroup({
  label, icon, channels, activeId, serverSlug,
}: {
  label: string;
  icon: React.ReactNode;
  channels: Channel[];
  activeId?: string;
  serverSlug: string;
}) {
  if (channels.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="px-2 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <ul className="mt-1 space-y-0.5">
        {channels.map((c) => (
          <li key={c.id}>
            <ChannelLink channel={c} activeId={activeId} serverSlug={serverSlug} icon={icon} />
          </li>
        ))}
      </ul>
    </div>
  );
}

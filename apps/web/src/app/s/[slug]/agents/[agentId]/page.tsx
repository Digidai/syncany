"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError, type Agent, type MessageRow } from "@/lib/api";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { EditAgentDialog } from "@/components/edit-agent-dialog";
import { AlertDialog, AlertDialogPopup, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogClose } from "@/components/heroui-pro/alert-dialog";
import { Button } from "@/components/heroui-pro/button";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel } from "@/components/heroui-pro/card";
import { Chip } from "@/components/heroui-pro/chip";
import { Tabs, TabsIndicator, TabsList, TabsListContainer, TabsTrigger } from "@/components/heroui-pro/tabs";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import { MessageSquare, Pencil, Trash2, Hash, ListChecks, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { notifyThrown, notifySuccess } from "@/lib/notify";

/**
 * Collapsed-by-default system prompt viewer. The schema cap is 50KB —
 * that's ~3000 lines of text and would shove the recent-DM card off
 * the page on any small viewport if always expanded. Show first ~12
 * lines (~64rem max), let the user expand on demand.
 */
function SystemPromptCard({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  // ~12 lines is enough to convey purpose without dominating the page.
  // We don't truncate the *content* — just visually clip via max-h.
  const isLong = prompt.length > 800 || prompt.split("\n").length > 12;
  return (
    <Card>
      <CardHeader>
        <CardTitle>System prompt</CardTitle>
        <CardDescription>The instructions this agent runs with.</CardDescription>
      </CardHeader>
      <CardPanel>
        <pre className={
          // [overflow-wrap:anywhere] handles single tokens longer than
          // the column (long URLs in prompts). overflow-x kept on `auto`
          // so a deliberately ASCII-art block can scroll rather than
          // get mangled — but whitespace-pre-wrap usually wraps it first.
          "min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] rounded bg-muted/50 p-3 text-xs leading-relaxed overflow-auto " +
          (expanded ? "max-h-[60vh]" : "max-h-64")
        }>{prompt}</pre>
        {isLong && (
          <Button type="button"
            variant="link"
            size="xs"
            onClick={() => setExpanded(v => !v)}
            className="mt-2 h-auto px-0 py-0 text-xs text-muted-foreground">
            {expanded ? "Show less" : "Show full prompt"}
          </Button>
        )}
      </CardPanel>
    </Card>
  );
}

const STATUS_LABEL: Record<string, { dot: string; text: string }> = {
  thinking: { dot: "bg-violet-500 animate-pulse", text: "Thinking…" },
  working:  { dot: "bg-blue-500 animate-pulse",   text: "Working…" },
  error:    { dot: "bg-red-500",                  text: "Error" },
  online:   { dot: "bg-emerald-500",              text: "Online" },
  sleeping: { dot: "bg-amber-500",                text: "Sleeping" },
  offline:  { dot: "bg-zinc-400",                 text: "Offline" },
};

export default function AgentProfilePage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const agentId = params.agentId as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [history, setHistory] = useState<MessageRow[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Tab state — held locally rather than in URL. Trade-off: simpler, no
  // route shuffle, but tabs aren't bookmarkable. If/when individual tab
  // pages grow heavy enough to warrant their own routes (Activity / Memory
  // / Calendar etc per the competitive analysis), promote each tab into
  // a real /agents/[id]/<tab>/page.tsx file.
  type TabKey = "chat" | "tasks" | "channels" | "settings";
  const [tab, setTab] = useState<TabKey>("chat");

  // Per-tab lazy-loaded data. Each tab fetches what it needs on first
  // mount; navigating away keeps the data so toggling tabs feels instant.
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof api.listTasks>>["tasks"] | null>(null);
  const [channels, setChannels] = useState<Array<{ id: string; name: string; type: string; joinedAt: number }> | null>(null);

  const live = useAgentActivity(agentId);

  // Cancel-aware reload — accepts a `live()` predicate from the caller so
  // a stale request landing after the user navigated away (or switched
  // agents) doesn't blow over the new state with the old one.
  async function reload(live: () => boolean = () => true) {
    if (live()) setError(null);
    try {
      const data = await api.listAgents();
      if (!live()) return null;
      const a = data.agents.find((x) => x.id === agentId) ?? null;
      if (!a) setError("Agent not found in your workspace.");
      setAgent(a);
      return a;
    } catch (e) {
      if (live()) setError(e instanceof ApiError ? e.message : String(e));
      return null;
    }
  }

  useEffect(() => {
    let cancelled = false;
    const live = () => !cancelled;
    setLoading(true);
    // Reset per-agent state — without this, navigating from agent A to
    // agent B inside the same route briefly shows A's history/tasks/
    // channels for B because the lazy-load guards see non-null and skip
    // refetch. We null them out so each tab re-fetches against the new id.
    setHistory(null);
    setHistoryError(null);
    setTasks(null);
    setChannels(null);
    reload(live).finally(() => { if (live()) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Lazy-load DM history once we know the dmChannelId. Surfaced below
  // the profile so the user sees recent context without leaving the page.
  useEffect(() => {
    if (!agent?.dmChannelId) return;
    let cancelled = false;
    api.listMessages(agent.dmChannelId, { limit: 20 }).then(d => {
      if (cancelled) return;
      // Reverse — listMessages returns newest first; we want oldest→newest
      // for natural reading order in the preview block.
      setHistory([...d.messages].reverse());
    }).catch(e => {
      if (cancelled) return;
      setHistoryError(e instanceof ApiError ? e.message : String(e));
    });
    return () => { cancelled = true; };
  }, [agent?.dmChannelId]);

  // Lazy-load tab data: tasks where this agent is the assignee.
  useEffect(() => {
    if (tab !== "tasks" || !agent || tasks !== null) return;
    let cancelled = false;
    api.listTasks({ serverId: agent.serverId, assigneeId: agent.id }).then(d => {
      if (cancelled) return;
      setTasks(d.tasks.filter((t) => t.assigneeType === "agent"));
    }).catch((e) => {
      // Surface the failure rather than showing "no tasks" which would
      // mislead the user. Empty array still ends up so the UI doesn't
      // hang on Loading… forever; the toast tells the real story.
      if (cancelled) return;
      notifyThrown("Couldn't load tasks", e);
      setTasks([]);
    });
    return () => { cancelled = true; };
  }, [tab, agent, tasks]);

  // Lazy-load tab data: channels this agent is a member of. Derived from
  // the workspace channel list filtered to ones containing this agent.
  // Note we need the workspace slug → server lookup; channel.members isn't
  // returned by getServerBySlug so we hit getChannel per candidate, which
  // is OK at our channel-per-workspace counts (<50 typical).
  useEffect(() => {
    if (tab !== "channels" || !agent || channels !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const srv = await api.getServerBySlug(slug);
        const memberships = await Promise.all(
          srv.channels.map((c) =>
            api.getChannel(c.id).then((d) => ({
              id: c.id, name: c.name, type: c.type,
              joinedAt: d.members.find((m) => m.memberId === agent.id)?.joinedAt ?? 0,
              isMember: d.members.some((m) => m.memberId === agent.id && m.memberType === "agent"),
            })).catch(() => null),
          ),
        );
        if (cancelled) return;
        setChannels(
          memberships
            .filter((m): m is NonNullable<typeof m> => m !== null && m.isMember)
            .map(({ id, name, type, joinedAt }) => ({ id, name, type, joinedAt })),
        );
      } catch (e) {
        if (cancelled) return;
        notifyThrown("Couldn't load channels", e);
        setChannels([]);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, agent, channels, slug]);

  async function handleDelete() {
    if (!agent) return;
    setDeleting(true);
    try {
      await api.deleteAgent(agent.id);
      notifySuccess(`Deleted ${agent.displayName}`);
      router.push(`/s/${slug}/settings`);
    } catch (e) {
      notifyThrown(`Delete ${agent.displayName} failed`, e);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const statusKey = live?.status ?? agent?.status ?? "offline";
  const statusInfo = STATUS_LABEL[statusKey] ?? STATUS_LABEL.offline;
  const headerSubtitle = useMemo(() => {
    const parts = [`@${agent?.name ?? ""}`, agent?.model ?? ""].filter(Boolean);
    return parts.join(" · ");
  }, [agent?.name, agent?.model]);

  if (loading) {
    return <div className="flex h-full w-full flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (error || !agent) {
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Agent unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error ?? "Not found."}</p>
          <Link href={`/s/${slug}/settings`} className="mt-4 inline-block text-sm underline">
            Back to settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* max-w-5xl keeps the action buttons next to the agent name on
          wide viewports instead of floating to the far right. Matches
          the body column constraint below so header + cards align. */}
      <header className="shrink-0 border-b border-border/70 bg-background/85 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 sm:flex-row sm:items-start">
          <GeneratedAvatar id={agent.id} name={agent.displayName} seed={agent.avatarSeed} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold">{agent.displayName}</h1>
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dot}`} />
                {statusInfo.text}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{headerSubtitle}</p>
            {agent.description && <p className="mt-1 text-sm">{agent.description}</p>}
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
            {agent.dmChannelId ? (
              <Button render={<Link href={`/s/${slug}/dm/${agent.dmChannelId}`} />} className="flex-1 sm:flex-none">
                <MessageSquare className="mr-1 h-3.5 w-3.5" /> Open DM
              </Button>
            ) : (
              // Legacy agent created before auto-DM landed. The server's
              // GET /agents lazy-backfills a DM channel on demand — so
              // simply re-fetching the agent list creates one. Surface
              // that as an explicit affordance so the user isn't stuck.
              <Button onClick={() => void reload()} className="flex-1 sm:flex-none"
                title="Create a DM channel for this agent">
                <MessageSquare className="mr-1 h-3.5 w-3.5" /> Set up DM
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditOpen(true)} className="flex-1 sm:flex-none">
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
            </Button>
            <Button variant="destructive-outline" onClick={() => setConfirmDelete(true)}
              className="flex-1 sm:flex-none"
              aria-label={`Delete ${agent.displayName}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {live?.label && (
          <p className="mx-auto mt-2 w-full max-w-5xl text-xs text-muted-foreground truncate">
            {live.label}{live.detail ? ` — ${live.detail}` : ""}
          </p>
        )}
      </header>

      {/* Tab nav sits in its own full-width bar (its own border-b),
          rather than nested inside the header at max-w-5xl with -mb-px.
          The old nesting made the header's bottom border peek out on
          the left + right of the centered tab strip and the active
          tab's 2px cyan border did not seam cleanly with the surrounding
          1px gray — visually "the top bar was a half / broken edge". */}
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => setTab(key as TabKey)}
        className="shrink-0 border-b border-border/70 bg-card"
      >
        <TabsListContainer className="mx-auto w-full max-w-5xl px-6">
          <TabsList aria-label="Agent sections" className="gap-1">
            <TabsIndicator />
          {([
            { key: "chat",     label: "Chat",     icon: MessageSquare },
            { key: "tasks",    label: "Tasks",    icon: ListChecks },
            { key: "channels", label: "Channels", icon: Hash },
            { key: "settings", label: "Settings", icon: SettingsIcon },
          ] as const).map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <TabsTrigger
                key={t.key}
                id={t.key}
                className={cn(
                  "h-10 gap-1.5 rounded-none px-3 text-sm",
                  active
                    ? "text-cyan-700 dark:text-cyan-400"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {t.label}
              </TabsTrigger>
            );
          })}
          </TabsList>
        </TabsListContainer>
      </Tabs>

      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-6">
        <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4">
          {tab === "chat" && (
            <>
              {agent.systemPrompt && <SystemPromptCard prompt={agent.systemPrompt} />}
              <Card>
                <CardHeader>
                  <CardTitle>Recent DM history</CardTitle>
                  <CardDescription>
                    {agent.dmChannelId ? "Last 20 messages between you two." : "No DM channel yet."}
                  </CardDescription>
                </CardHeader>
                <CardPanel>
                  {historyError && <p className="text-sm text-danger-text">{historyError}</p>}
                  {!historyError && history === null && agent.dmChannelId && (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  )}
                  {history && history.length === 0 && (
                    <p className="text-sm text-muted-foreground">No messages yet. Open the DM to say hi.</p>
                  )}
                  {history && history.length > 0 && (
                    <ul className="space-y-2">
                      {history.map((m) => (
                      <Card render={<li />} key={m.id} className="border-transparent bg-[var(--surface-secondary)] !shadow-none">
                        <CardPanel className="p-2 text-sm">
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>{m.senderType === "agent" ? agent.displayName : "You"}</span>
                            <time>{new Date(m.createdAt).toLocaleString()}</time>
                          </div>
                          <p className="mt-1 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{m.content}</p>
                        </CardPanel>
                      </Card>
                      ))}
                    </ul>
                  )}
                </CardPanel>
              </Card>
            </>
          )}

          {tab === "tasks" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4" /> Assigned to {agent.displayName}
                </CardTitle>
                <CardDescription>
                  Tasks where this agent is the assignee, across every channel.
                </CardDescription>
              </CardHeader>
              <CardPanel>
                {tasks === null && <p className="text-sm text-muted-foreground">Loading…</p>}
                {tasks && tasks.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No tasks assigned. Convert a message into a task and assign it to <span className="font-medium text-foreground">{agent.displayName}</span> to see it here.
                  </p>
                )}
                {tasks && tasks.length > 0 && (
                  <ul className="space-y-2">
                    {tasks.map((t) => (
                      <Card render={<li />} key={t.id} className="border-transparent bg-[var(--surface-secondary)] !shadow-none">
                        <CardPanel className="flex flex-wrap items-center gap-3 p-3 text-sm">
                        <span className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          t.status === "done" ? "bg-emerald-500"
                            : t.status === "in_progress" ? "bg-blue-500"
                            : t.status === "in_review" ? "bg-amber-500"
                            : "bg-zinc-400",
                        )} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{t.title ?? `#${t.taskNumber}`}</div>
                          <div className="text-[11px] text-muted-foreground">
                            #{t.taskNumber} · {t.status.replace(/_/g, " ")} ·{" "}
                            updated {new Date(t.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                        </CardPanel>
                      </Card>
                    ))}
                  </ul>
                )}
              </CardPanel>
            </Card>
          )}

          {tab === "channels" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Hash className="h-4 w-4" /> Member of
                </CardTitle>
                <CardDescription>
                  Channels this agent listens in. To add or remove, open the
                  channel and edit its member list.
                </CardDescription>
              </CardHeader>
              <CardPanel>
                {channels === null && <p className="text-sm text-muted-foreground">Loading…</p>}
                {channels && channels.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Not a member of any channel yet (except its own DM).
                  </p>
                )}
                {channels && channels.length > 0 && (
                  <ul className="space-y-1.5">
                    {channels.map((c) => (
                      <Card render={<li />} key={c.id} className="border-transparent bg-[var(--surface-secondary)] !shadow-none transition-colors hover:border-accent/25">
                        <CardPanel className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-sm">
                        <Link
                          href={`/s/${slug}/${c.type === "dm" ? "dm" : "channel"}/${c.id}`}
                          className="flex min-w-0 flex-1 items-center gap-2"
                        >
                          <span className="text-muted-foreground" aria-hidden="true">
                            {c.type === "dm" ? "@" : c.type === "private" ? "🔒" : "#"}
                          </span>
                          <span className="truncate font-medium">{c.name}</span>
                        </Link>
                        <span className="shrink-0 text-[10.5px] text-muted-foreground">
                          since {new Date(c.joinedAt).toLocaleDateString()}
                        </span>
                        </CardPanel>
                      </Card>
                    ))}
                  </ul>
                )}
              </CardPanel>
            </Card>
          )}

          {tab === "settings" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SettingsIcon className="h-4 w-4" /> Settings
                </CardTitle>
                <CardDescription>
                  Edit display name, system prompt, runtime, model. Identifier (@handle) is immutable.
                </CardDescription>
              </CardHeader>
              <CardPanel>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Button onClick={() => setEditOpen(true)}>
                    <Pencil className="me-1 h-3.5 w-3.5" /> Edit agent
                  </Button>
                  <Button variant="destructive-outline" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="me-1 h-3.5 w-3.5" /> Delete agent
                  </Button>
                </div>
                <dl className="mt-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-2">
                  <dt className="text-muted-foreground">Identifier</dt>
                  <dd className="min-w-0 break-all font-mono">@{agent.name}</dd>
                  <dt className="text-muted-foreground">Runtime</dt>
                  <dd><Chip size="sm" variant="soft" color="accent" className="capitalize">{agent.runtime}</Chip></dd>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="min-w-0 break-all font-mono">{agent.model}</dd>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>{new Date(agent.createdAt).toLocaleString()}</dd>
                </dl>
                {agent.description && (
                  <div className="mt-6">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Description</p>
                    <p className="mt-1 text-sm">{agent.description}</p>
                  </div>
                )}
              </CardPanel>
            </Card>
          )}
        </div>
      </div>

      <EditAgentDialog
        agent={agent}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => { void reload(); }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {agent.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the agent and its DM channel. Past
              messages in shared channels are preserved but the agent will
              no longer respond.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" type="button">Cancel</Button>} />
            <Button variant="destructive" onClick={handleDelete} loading={deleting}>Delete</Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

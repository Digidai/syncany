"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { Cpu, MessageSquare, Pencil, Plus, ArrowRight } from "lucide-react";
import { api, type Agent } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { CreateAgentDialog } from "@/components/create-agent-dialog";
import { Button } from "@/components/heroui-pro/button";
import { Card, CardPanel } from "@/components/heroui-pro/card";
import { Chip } from "@/components/heroui-pro/chip";
import { WorkspaceEmptyState, WorkspacePage } from "@/components/workspace-page";
import { useAgentActivities } from "@/hooks/use-agent-activity";
import { cn } from "@/lib/utils";

/**
 * Workspace-level agents directory. Sibling to /inbox, /tasks, /people —
 * accessible from the sidebar top-level nav.
 *
 * Replaces the old "Agents" sidebar SECTION which listed every agent
 * inline (alongside the parallel "Direct messages" list that had the
 * same agents in DM form — two parallel lists of the same entities).
 * The dedicated page lets us show richer context per agent (runtime,
 * status, description, last activity) without consuming permanent
 * sidebar real estate.
 *
 * What this page does NOT do (delegates intentionally):
 *   - CRUD lifecycle (rename/delete) → Settings → Channels & agents.
 *   - Per-agent profile / chat history → /s/{slug}/agents/{id}.
 *   - DM with the agent → click the "Message" affordance, which uses
 *     api.openDm to find-or-create the DM channel and routes there.
 */
export default function AgentsIndexPage() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const activities = useAgentActivities();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [serverId, setServerId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // Fetch in parallel: workspace metadata gives us the serverId for
      // create-dialog + DM open; agents list is the page's main payload.
      const [{ server }, { agents: all }] = await Promise.all([
        api.getServerBySlug(slug),
        api.listAgents(),
      ]);
      setServerId(server.id);
      // listAgents returns cross-workspace; scope to current.
      setAgents(all.filter((a) => a.serverId === server.id));
    } catch (e) {
      notifyThrown("Couldn't load agents", e);
      setAgents([]);
    }
  }, [slug]);
  useEffect(() => { reload(); }, [reload]);

  async function handleMessage(agent: Agent) {
    if (!serverId || opening) return;
    setOpening(agent.id);
    try {
      // Agents always have an auto-created DM (from agents.ts:98), but
      // we still go through openDm so the page handles legacy agents
      // missing dmChannelId without a special-case.
      const { channelId } = await api.openDm({
        serverId, peerType: "agent", peerId: agent.id,
      });
      router.push(`/s/${slug}/dm/${channelId}`);
    } catch (e) {
      notifyThrown("Couldn't open DM", e);
    } finally {
      setOpening(null);
    }
  }

  return (
    <WorkspacePage
      title="Agents"
      description="AI teammates in this workspace. Click to view profile; Message opens the direct chat."
      icon={<Cpu className="h-5 w-5" aria-hidden="true" />}
      tone="emerald"
      actions={
        serverId ? (
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              variant="outline"
              size="sm"
              className="shrink-0"
            >
              <Plus className="h-3.5 w-3.5" /> New agent
            </Button>
          ) : null
      }
    >
          {agents === null && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {agents !== null && agents.length === 0 && (
            <WorkspaceEmptyState
              icon={<Cpu className="h-8 w-8" />}
              title="No agents yet."
              description="Create your first AI teammate to start collaborating in channels."
              action={serverId && (
                <Button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  variant="outline"
                  size="sm"
                >
                  <Plus className="h-3.5 w-3.5" /> Create agent
                </Button>
              )}
            />
          )}
          {agents !== null && agents.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {agents.map((a) => {
                const act = activities[a.id];
                return (
                  <Card render={<li />} key={a.id} className="border-border/60 bg-surface/80 !shadow-none transition-colors hover:border-accent/25">
                    <CardPanel className="p-3">
                    <div className="flex items-start gap-3">
                      <GeneratedAvatar id={a.id} name={a.displayName} seed={a.avatarSeed} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/s/${slug}/agents/${a.id}`}
                            className="truncate font-medium hover:underline"
                          >
                            {a.displayName}
                          </Link>
                          <RuntimeChip runtime={a.runtime} />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          <span className="font-mono">@{a.name}</span> · {a.model}
                        </p>
                        {a.description && (
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{a.description}</p>
                        )}
                        <div className="mt-2 flex items-center gap-3 text-[11px]">
                          <StatusDot status={act?.status ?? (a.status === "online" ? "idle" : "offline")} />
                          {act?.label && <span className="truncate text-muted-foreground">{act.label}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        render={<Link href={`/s/${slug}/agents/${a.id}`} />}
                        className="text-xs text-muted-foreground"
                      >
                        <Pencil className="h-3 w-3" /> Profile
                      </Button>
                      <Button
                        type="button"
                        onClick={() => handleMessage(a)}
                        disabled={opening === a.id}
                        variant="outline"
                        size="xs"
                        className="text-xs"
                      >
                        <MessageSquare className="h-3 w-3" />
                        {opening === a.id ? "Opening…" : "Message"}
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    </div>
                    </CardPanel>
                  </Card>
                );
              })}
            </ul>
          )}
      {serverId && (
        <CreateAgentDialog
          serverId={serverId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => { setCreateOpen(false); reload(); }}
        />
      )}
    </WorkspacePage>
  );
}

function RuntimeChip({ runtime }: { runtime: string }) {
  // Accept `string` (not RuntimeId) because agents.runtime is plain TEXT
  // post-S2 and the server may pass through legacy "gemini"/"copilot"
  // values from pre-removal rows. Fall through to a neutral zinc tone
  // for unknown runtimes — never throw, never white-screen. Detected
  // by review (backcompat H1).
  const tone: Record<string, "accent" | "warning" | "default" | "danger"> = {
    claude:   "accent",
    codex:    "warning",
    openclaw: "default",
    hermes:   "danger",
  };
  return (
    <Chip size="sm" variant="soft" color={tone[runtime] ?? "default"} className="text-[9px] uppercase tracking-wider">
      {runtime}
    </Chip>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "thinking" ? "bg-violet-500 animate-pulse" :
    status === "working"  ? "bg-blue-500 animate-pulse" :
    status === "error"    ? "bg-red-500" :
    status === "idle"     ? "bg-emerald-500" : "bg-zinc-400";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", color)} aria-hidden="true" />
      <span className="text-muted-foreground">{status}</span>
    </span>
  );
}

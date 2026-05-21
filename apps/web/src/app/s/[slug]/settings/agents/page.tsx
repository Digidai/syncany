"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Hash, Cpu, MessageSquare, Pencil, Trash2, Lock, Plus, ArrowRight } from "lucide-react";
import { api, type Agent, type Channel } from "@/lib/api";
import { notifySuccess, notifyThrown } from "@/lib/notify";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel } from "@raltic/ui/components/ui/card";
import { Button } from "@raltic/ui/components/ui/button";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { CreateChannelDialog } from "@/components/create-channel-dialog";
import { CreateAgentDialog } from "@/components/create-agent-dialog";
import { EditAgentDialog } from "@/components/edit-agent-dialog";
import { ConfirmDialog } from "@raltic/ui/components/ui/confirm-dialog";
import { useSettings, SettingsSection } from "../layout";

// Design contract for this tab:
//
//   • Channels card and Agents card mirror each other structurally —
//     header with title + "New" button, then a list of rows. No more
//     asymmetric "Agents has a list, Channels has just a button".
//
//   • Every entity row uses the same row shape: avatar/icon → meta block
//     (name + identifier + status) → quick actions. Same shape as the
//     sidebar agent rows + agent profile header, so the visual language
//     stays consistent across surfaces.
//
//   • The agent name itself links to the profile page (`/agents/:id`),
//     which is the canonical deep view. Edit/Delete actions stay inline
//     so users don't have to navigate just to rename or remove.

export default function ChannelsAgentsPage() {
  const { server } = useSettings();
  const { slug } = useParams<{ slug: string }>();

  const [openChannel, setOpenChannel] = useState(false);
  const [openAgent, setOpenAgent] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editAgentOpen, setEditAgentOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);

  async function reload() {
    // Both lists in one fetch — we already pay for getServerBySlug at
    // the layout level, so this is a cheap refresh of just what this
    // tab needs. listAgents returns cross-workspace results; filter.
    const [agentsRes, serverRes] = await Promise.all([
      api.listAgents().catch(() => ({ agents: [] })),
      api.getServerBySlug(slug).catch(() => ({ channels: [] as Channel[] })),
    ]);
    setAgents(agentsRes.agents.filter((a) => a.serverId === server.id));
    setChannels(("channels" in serverRes ? serverRes.channels : []) as Channel[]);
  }
  useEffect(() => { reload(); }, [server.id, slug]);

  async function confirmDeleteAgent() {
    if (!deleteTarget) return;
    try {
      await api.deleteAgent(deleteTarget.id);
      reload();
      notifySuccess(`Deleted ${deleteTarget.displayName}`);
    } catch (e) {
      notifyThrown("Couldn't delete agent", e);
    } finally {
      setDeleteTarget(null);
    }
  }

  // Channels excluded from this list: DM channels. They live in the
  // sidebar's "Direct messages" section and are auto-created per agent;
  // surfacing them here would double-count and clutter.
  const manageableChannels = channels.filter((c) => c.type !== "dm");

  return (
    <SettingsSection title="Channels & agents" description="Spaces for conversations and the AI teammates that join them.">
      {/* ── Channels ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2"><Hash className="h-4 w-4" /> Channels</CardTitle>
              <CardDescription>
                {manageableChannels.length === 0
                  ? "No channels yet."
                  : `${manageableChannels.length} ${manageableChannels.length === 1 ? "channel" : "channels"} in this workspace.`}
              </CardDescription>
            </div>
            <Button onClick={() => setOpenChannel(true)} size="sm" className="shrink-0">
              <Plus className="me-1 h-3.5 w-3.5" /> New channel
            </Button>
          </div>
        </CardHeader>
        {manageableChannels.length > 0 && (
          <CardPanel>
            <ul className="space-y-1.5">
              {manageableChannels.map((c) => (
                <ChannelRow key={c.id} channel={c} slug={slug} />
              ))}
            </ul>
          </CardPanel>
        )}
      </Card>

      {/* ── Agents ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2"><Cpu className="h-4 w-4" /> Agents</CardTitle>
              <CardDescription>
                {agents.length === 0
                  ? "No agents yet. Add your first one to bring AI teammates into channels."
                  : "AI teammates that run on your laptop via the bridge."}
              </CardDescription>
            </div>
            <Button onClick={() => setOpenAgent(true)} size="sm" className="shrink-0">
              <Plus className="me-1 h-3.5 w-3.5" /> New agent
            </Button>
          </div>
        </CardHeader>
        {agents.length > 0 && (
          <CardPanel>
            <ul className="space-y-2">
              {agents.map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  slug={slug}
                  onEdit={() => { setEditingAgent(a); setEditAgentOpen(true); }}
                  onDelete={() => setDeleteTarget(a)}
                />
              ))}
            </ul>
          </CardPanel>
        )}
        {/* Restore link — shown when the workspace owner has no agent
            named "onboarding" (either deleted by the owner, or invited
            flow where the personal workspace was created bare). Owner-
            only on the server side too. */}
        {!agents.some((a) => a.name === "onboarding") && server.role === "owner" && (
          <CardPanel>
            <RestoreOnboardingRow serverId={server.id} onRestored={reload} />
          </CardPanel>
        )}
      </Card>

      <CreateChannelDialog
        serverId={server.id}
        open={openChannel}
        onOpenChange={setOpenChannel}
        onCreated={() => location.reload()}
      />
      <CreateAgentDialog
        serverId={server.id}
        open={openAgent}
        onOpenChange={setOpenAgent}
        onCreated={reload}
      />
      <EditAgentDialog
        agent={editingAgent}
        open={editAgentOpen}
        onOpenChange={setEditAgentOpen}
        onSaved={() => { reload(); notifySuccess("Agent updated"); }}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title={deleteTarget ? `Delete ${deleteTarget.displayName}?` : "Delete agent?"}
        description="This removes the agent and its DM channel. The bridge will stop spawning a process for it. Past messages it sent stay in their channels."
        confirmLabel="Delete agent"
        onConfirm={confirmDeleteAgent}
      />
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Row components — shared shape: icon/avatar → meta → actions. Mirror each
// other so the two sections in this tab read as one design language.
// ---------------------------------------------------------------------------

function ChannelRow({ channel, slug }: { channel: Channel; slug: string }) {
  const Icon = channel.type === "private" ? Lock : Hash;
  return (
    <li className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors hover:border-border hover:bg-accent/40">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{channel.name}</span>
          {channel.type === "private" && (
            <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-700">private</span>
          )}
        </div>
        {channel.description && (
          <p className="truncate text-xs text-muted-foreground">{channel.description}</p>
        )}
      </div>
      <Button variant="ghost" size="sm" render={<Link href={`/s/${slug}/channel/${channel.id}`} />}>
        Open <ArrowRight className="ms-1 h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

function AgentRow({
  agent, slug, onEdit, onDelete,
}: {
  agent: Agent;
  slug: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const statusColor =
    agent.status === "online" ? "bg-emerald-500"
    : agent.status === "sleeping" ? "bg-amber-500"
    : "bg-zinc-400";
  const statusLabel =
    agent.status === "online" ? "online"
    : agent.status === "sleeping" ? "idle"
    : "offline";
  return (
    <li className="flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-accent/30">
      <GeneratedAvatar id={agent.id} name={agent.displayName} seed={agent.avatarSeed} size="md" />
      <div className="min-w-0 flex-1">
        {/* Name links to profile — that's the canonical "manage agent"
            deep view. Quick actions on the right cover the common cases
            without forcing a navigation. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/s/${slug}/agents/${agent.id}`}
            className="truncate font-medium hover:underline"
          >
            {agent.displayName}
          </Link>
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
            @{agent.name}
          </span>
          <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-700">
            {agent.model}
          </span>
          <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
        {agent.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{agent.description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {agent.dmChannelId && (
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={`/s/${slug}/dm/${agent.dmChannelId}`} />}
            aria-label={`Open DM with ${agent.displayName}`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${agent.displayName}`}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          aria-label={`Delete ${agent.displayName}`}
          className="text-destructive-foreground hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

/**
 * Inline "Restore Onboarding Assistant" affordance — appears only when
 * the workspace owner has no agent named "onboarding" (either deleted
 * intentionally, or the workspace is invite-flow-bare). Posts to
 * /api/v1/servers/:id/seed which idempotent-seeds the standard
 * personal-workspace content + welcome messages.
 */
function RestoreOnboardingRow({ serverId, onRestored }: { serverId: string; onRestored: () => void }) {
  const [restoring, setRestoring] = useState(false);
  async function handleRestore() {
    setRestoring(true);
    try {
      await api.seedServer(serverId, { force: true });
      notifySuccess("Onboarding Assistant restored");
      onRestored();
    } catch (e) {
      notifyThrown("Couldn't restore Onboarding Assistant", e);
    } finally {
      setRestoring(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">No Onboarding Assistant in this workspace.</p>
        <p className="text-xs text-muted-foreground">
          Re-create the starter agent + welcome channels (#onboarding + DM).
        </p>
      </div>
      <Button onClick={handleRestore} loading={restoring} variant="outline" size="sm" className="shrink-0">
        Restore
      </Button>
    </div>
  );
}

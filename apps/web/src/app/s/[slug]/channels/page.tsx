"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Hash, ArrowRight, Check } from "lucide-react";
import { api } from "@/lib/api";
import { notifyThrown, notifySuccess } from "@/lib/notify";

/**
 * Browse + join public channels in this workspace.
 *
 * Sibling to /agents and /people in the top-level nav. Solves the
 * discovery gap: previously a workspace invitee could only see channels
 * they were explicitly added to — there was no surface to find #general
 * or #design unless someone @-mentioned them in one.
 *
 * Out of scope:
 *   - Private channel discovery (members-only by design)
 *   - Browsing across workspaces (channels are workspace-scoped)
 *   - Leaving channels (handled per-channel header — TBD)
 */
type Row = Awaited<ReturnType<typeof api.browseChannels>>["channels"][number];

export default function ChannelsBrowsePage() {
  const { slug } = useParams<{ slug: string }>();
  const [serverId, setServerId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  async function load() {
    try {
      const { server } = await api.getServerBySlug(slug);
      setServerId(server.id);
      const { channels } = await api.browseChannels(server.id);
      // Stable sort: oldest first (createdAt asc). New channels float
      // to the end so the directory order doesn't shift on every visit.
      setRows([...channels].sort((a, b) => a.createdAt - b.createdAt));
    } catch (e) {
      notifyThrown("Couldn't load channels", e);
      setRows([]);
    }
  }
  useEffect(() => { load(); }, [slug]);

  async function handleJoin(row: Row) {
    if (joining) return;
    setJoining(row.id);
    try {
      const res = await api.joinChannel(row.id);
      notifySuccess(res.alreadyMember ? "Already a member" : `Joined #${row.name}`);
      // Update local row to flip isMember without a full reload.
      setRows((prev) => prev?.map((r) => r.id === row.id ? { ...r, isMember: true } : r) ?? null);
      // Tell the sidebar to re-fetch this workspace's channels so the
      // newly-joined channel shows up in the left rail immediately.
      // Sidebar listens for this event in apps/web/src/components/sidebar.tsx.
      // CustomEvent over a context here keeps the channels page decoupled
      // from layout/sidebar — no prop drilling through the Next route layer.
      window.dispatchEvent(new CustomEvent("raltic:channels-changed"));
    } catch (e) {
      notifyThrown("Couldn't join channel", e);
    } finally {
      setJoining(null);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">
            <Hash className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Channels</h1>
            <p className="text-xs text-muted-foreground">
              Public channels in this workspace. Click <em>Join</em> to add one to your sidebar.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          {rows === null && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {rows !== null && rows.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Hash className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">No public channels yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Admins can create channels from Settings → Channels & agents.
              </p>
            </div>
          )}
          {rows !== null && rows.length > 0 && (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">
                    <Hash className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/s/${slug}/channel/${r.id}`}
                      className="truncate font-medium hover:underline"
                    >
                      #{r.name}
                    </Link>
                    {r.description && (
                      <p className="truncate text-[11px] text-muted-foreground">{r.description}</p>
                    )}
                  </div>
                  {r.isMember ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3 w-3" /> Joined
                    </span>
                  ) : (
                    <button
                      onClick={() => handleJoin(r)}
                      disabled={joining === r.id}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                    >
                      {joining === r.id ? "Joining…" : "Join"}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

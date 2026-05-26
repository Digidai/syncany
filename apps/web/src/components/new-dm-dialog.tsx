"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, MessageSquare, X } from "lucide-react";
import { api, type Agent } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { authClient } from "@/lib/auth-client";
import { GeneratedAvatar } from "@/components/generated-avatar";
import {
  Dialog, DialogPortal, DialogBackdrop, DialogPopup,
  DialogHeader, DialogTitle, DialogPanel,
} from "@/components/heroui-pro/dialog";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { cn } from "@/lib/utils";

interface Props {
  serverId: string;
  serverSlug: string;
  // existingDmPeers — set of (memberType:memberId) strings for the
  // OTHER party in each existing DM. Used to render a "(in DMs)" hint
  // so users know they already have a thread with this person.
  existingDmPeers: Set<string>;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  // Called AFTER a DM is successfully opened (find-or-create) so the
  // sidebar can refetch its channels list — otherwise a brand-new DM
  // doesn't appear in the Direct messages section until a hard reload.
  onOpened?: () => void;
}

type Member = Awaited<ReturnType<typeof api.listMembers>>["members"][number];

/**
 * Modal picker for starting a new DM. Lists all workspace members
 * (humans + agents) excluding the current user, with a search box for
 * larger workspaces. Click an entry → calls api.openDm (find-or-create)
 * → navigates to the resulting channel. Idempotent on the server side
 * so re-clicking someone already in DMs just opens that channel again.
 *
 * Mounted from sidebar.tsx; opened by the "+" button in the Direct
 * messages section header.
 */
export function NewDmDialog({
  serverId, serverSlug, existingDmPeers, open, onOpenChange, onOpened,
}: Props) {
  const router = useRouter();
  const session = authClient.useSession();
  // sessionPending: better-auth hasn't resolved /me yet. meId is null
  // here, so we MUST NOT render the members list (the `meId` filter at
  // line ~80 would let the user click themselves and self-DM).
  const sessionPending = session.isPending;
  const meId = session.data?.user?.id ?? null;

  const [members, setMembers] = useState<Member[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  // Focus restoration: stash the element that had focus when the dialog
  // opened, restore it on close. Without this, keyboard users who opened
  // via Enter on the "+" button find themselves dumped to <body> when
  // they close. Stored in a ref to avoid re-renders on every focus shift.
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset query when the dialog closes so re-opening starts fresh.
      // Without this a user who searched "alice" + cancelled would see
      // a stale filter next open.
      setQuery("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.listMembers(serverId).catch(() => ({ members: [] as Member[] })),
      api.listAgents().catch(() => ({ agents: [] as Agent[] })),
    ]).then(([m, a]) => {
      if (cancelled) return;
      setMembers(m.members);
      setAgents(a.agents.filter((ag) => ag.serverId === serverId));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, serverId]);

  // Open/close side effects: Escape to dismiss, focus trap on Tab so
  // keyboard users can't escape into the dimmed page behind the modal,
  // and focus restoration when the dialog closes.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
      if (e.key !== "Tab") return;
      // Cycle focus inside the dialog. Without a trap, Tab/Shift-Tab
      // leaks to the workspace shell behind the backdrop (which is
      // visually dimmed but still reachable for screen readers).
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Restore focus to the element that opened the dialog. Defer to
      // next tick so React has unmounted dialog children first.
      const t = triggerRef.current;
      if (t && document.body.contains(t)) {
        queueMicrotask(() => t.focus());
      }
    };
  }, [open, onOpenChange]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const humans = members
      .filter((m) => m.userId !== meId)
      .map((m) => ({ kind: "human" as const, id: m.userId, name: m.name, sub: m.email ?? "", image: m.image }));
    const ags = agents
      .map((a) => ({ kind: "agent" as const, id: a.id, name: a.displayName, sub: `@${a.name}`, image: null as string | null }));
    const all = [...humans, ...ags];
    if (!q) return all;
    return all.filter((r) => r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q));
  }, [members, agents, query, meId]);

  async function pick(row: { kind: "human" | "agent"; id: string }) {
    if (opening) return;
    setOpening(row.id);
    try {
      const { channelId } = await api.openDm({
        serverId, peerType: row.kind, peerId: row.id,
      });
      onOpenChange(false);
      // Refresh sidebar BEFORE navigating — pushing to /dm/:id otherwise
      // shows an "unknown channel" gap while the sidebar's stale
      // channels[] catches up on the next workspace refetch.
      onOpened?.();
      router.push(`/s/${serverSlug}/dm/${channelId}`);
    } catch (e) {
      notifyThrown("Couldn't open DM", e);
    } finally {
      setOpening(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="sm:max-w-md">
          <DialogHeader className="flex-row items-start justify-between gap-3">
          <div>
            <DialogTitle>Start a direct message</DialogTitle>
            <p className="text-[11px] text-muted-foreground">
              Pick a teammate or agent from this workspace.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </DialogHeader>

        <DialogPanel>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              aria-label="Search people or agents"
              autoFocus
              value={query}
              onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
              placeholder="Search people or agents…"
              className="pl-8"
            />
          </div>

        <ul className="mt-3 max-h-72 overflow-y-auto rounded-lg border bg-card/40 p-2">
          {(loading || sessionPending) && (
            // sessionPending blocks list render too: meId is null until
            // /me resolves, and the `m.userId !== meId` filter on the
            // members list would otherwise let the current user click
            // themselves and self-DM (a 1-on-1 channel with no peer).
            <li className="px-2 py-2 text-xs text-muted-foreground">Loading…</li>
          )}
          {!loading && !sessionPending && filtered.length === 0 && (
            <li className="px-2 py-2 text-xs text-muted-foreground">No matches.</li>
          )}
          {!loading && !sessionPending && filtered.map((row) => {
            const alreadyDm = existingDmPeers.has(`${row.kind}:${row.id}`);
            return (
              <li key={`${row.kind}:${row.id}`}>
                <Button
                  type="button"
                  onClick={() => pick(row)}
                  disabled={opening === row.id}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-auto w-full justify-start gap-3 px-2 py-1.5 text-left",
                    opening === row.id && "opacity-50",
                  )}
                >
                  {row.image ? (
                    <img src={row.image} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                  ) : (
                    <GeneratedAvatar id={row.id} name={row.name} size="sm" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm">
                      <span className="truncate">{row.name}</span>
                      {row.kind === "agent" && (
                        <span className="rounded-full bg-cyan-500/10 px-1 py-px text-[8px] font-medium uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
                          AI
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {row.sub}{alreadyDm ? " · in DMs" : ""}
                    </div>
                  </div>
                  <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
        </DialogPanel>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

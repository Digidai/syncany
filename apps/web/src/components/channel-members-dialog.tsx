"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Check, Search, UserMinus, UserPlus } from "lucide-react";
import { useWorkspacePresence } from "@/hooks/use-agent-activity";
import {
  Dialog, DialogPortal, DialogBackdrop, DialogPopup,
  DialogHeader, DialogTitle, DialogPanel, DialogFooter, DialogClose,
} from "@/components/heroui-pro/dialog";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { api, ApiError, type Agent, type Channel, type ChannelMember } from "@/lib/api";
import { notifySuccess, notifyThrown } from "@/lib/notify";
import { ConfirmDialog } from "./confirm-dialog";

type PersonRow = { userId: string; name: string; email: string | null; image: string | null };

interface Props {
  channel: Channel;
  /** Channel members straight from api.getChannel. The dialog
   *  re-fetches names/avatars separately to keep this prop simple. */
  initialMembers: ChannelMember[];
  /** Viewer can add new humans + agents (any current member can,
   *  matches policy.channels.canAddMember). */
  canAdd: boolean;
  /** Viewer can remove OTHER members (channel creator OR workspace
   *  owner only, matches policy.channels.canRemoveMember). */
  canRemove: boolean;
  /** Self user id — needed to disable the "remove me" button on
   *  self-row (self-leave uses a different endpoint). */
  selfUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any successful add/remove so the parent re-fetches. */
  onChanged?: () => void;
}

export function ChannelMembersDialog({
  channel, initialMembers, canAdd, canRemove, selfUserId, open, onOpenChange, onChanged,
}: Props) {
  // Workspace slug for click-through links to /people/[id], /agents/[id].
  // The dialog is mounted under /s/[slug]/... so the param is always present.
  const params = useParams<{ slug?: string }>();
  const serverSlug = params?.slug ?? "";
  // Per-row online indicator (Phase A — codex requested in spec). Hook
  // is ref-counted so opening the dialog adds one subscriber; closing
  // releases it cleanly via React's effect cleanup.
  const presence = useWorkspacePresence(channel.serverId);
  // Resolved roster (names + avatars). Keyed by `${type}:${id}`.
  const [people, setPeople] = useState<Map<string, PersonRow>>(new Map());
  const [agentsMap, setAgentsMap] = useState<Map<string, Agent>>(new Map());
  // Add-picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allMembers, setAllMembers] = useState<PersonRow[]>([]);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [selectedHumans, setSelectedHumans] = useState<Set<string>>(new Set());
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pending-removal target — drives the ConfirmDialog. Cleared when
  // the dialog closes (cancel) or after the remove call completes.
  const [removeTarget, setRemoveTarget] = useState<
    { type: "human" | "agent"; id: string; label: string } | null
  >(null);

  useEffect(() => {
    if (!open) return;
    setPickerOpen(false); setSelectedHumans(new Set()); setSelectedAgents(new Set());
    setQuery(""); setError(null);
    let cancelled = false;
    (async () => {
      try {
        const [m, a] = await Promise.all([
          api.listMembers(channel.serverId),
          api.listAgents().then(r => r.agents.filter(ag => ag.serverId === channel.serverId)),
        ]);
        if (cancelled) return;
        setAllMembers(m.members.map(p => ({
          userId: p.userId, name: p.name, email: p.email, image: p.image,
        })));
        setAllAgents(a);
        // Build name lookup for the existing roster.
        const pp = new Map<string, PersonRow>();
        for (const p of m.members) {
          pp.set(`human:${p.userId}`, { userId: p.userId, name: p.name, email: p.email, image: p.image });
        }
        setPeople(pp);
        const aa = new Map<string, Agent>();
        for (const ag of a) aa.set(`agent:${ag.id}`, ag);
        setAgentsMap(aa);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [open, channel.serverId]);

  // Members of THIS channel, partitioned by type.
  const humanMembers = useMemo(
    () => initialMembers.filter(m => m.memberType === "human"),
    [initialMembers],
  );
  const agentMembers = useMemo(
    () => initialMembers.filter(m => m.memberType === "agent"),
    [initialMembers],
  );

  // Pool for the add picker = workspace members/agents NOT already in channel.
  const existingHumanIds = useMemo(() => new Set(humanMembers.map(m => m.memberId)), [humanMembers]);
  const existingAgentIds = useMemo(() => new Set(agentMembers.map(m => m.memberId)), [agentMembers]);
  const candidateHumans = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allMembers
      .filter(m => !existingHumanIds.has(m.userId) && m.userId !== selfUserId)
      .filter(m => !q || m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q));
  }, [allMembers, existingHumanIds, selfUserId, query]);
  const candidateAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allAgents
      .filter(a => !existingAgentIds.has(a.id))
      .filter(a => !q || a.displayName.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  }, [allAgents, existingAgentIds, query]);

  async function handleAdd() {
    if (busy) return;
    if (selectedHumans.size + selectedAgents.size === 0) return;
    setBusy(true); setError(null);
    try {
      await api.addChannelMembers(channel.id, {
        memberIds: selectedHumans.size > 0 ? [...selectedHumans] : undefined,
        agentIds: selectedAgents.size > 0 ? [...selectedAgents] : undefined,
      });
      notifySuccess(`Added ${selectedHumans.size + selectedAgents.size}`);
      window.dispatchEvent(new CustomEvent("raltic:channels-changed"));
      setSelectedHumans(new Set()); setSelectedAgents(new Set());
      setPickerOpen(false);
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function performRemove() {
    if (!removeTarget || busy) return;
    setBusy(true);
    try {
      await api.removeChannelMember(channel.id, removeTarget.type, removeTarget.id);
      notifySuccess(`Removed ${removeTarget.label}`);
      window.dispatchEvent(new CustomEvent("raltic:channels-changed"));
      setRemoveTarget(null);
      onChanged?.();
    } catch (e) {
      notifyThrown("Couldn't remove member", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Members of #{channel.name}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            {!pickerOpen ? (
              <div className="space-y-3">
                {canAdd && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-center"
                    onClick={() => setPickerOpen(true)}
                  >
                    <UserPlus className="h-4 w-4" />
                    Add people or agents
                  </Button>
                )}
                {/* Surface initial-load error in the roster view too —
                    codex C3 MED: error was only rendered inside the
                    picker branch, so a roster-only viewer would never
                    see why their list is empty. */}
                {error && !pickerOpen && (
                  <p role="alert" className="text-sm text-danger-text">{error}</p>
                )}
                <div className="max-h-80 overflow-y-auto rounded-xl border border-border bg-[var(--surface-secondary)]">
                  {humanMembers.length === 0 && agentMembers.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">No members yet.</p>
                  ) : (
                    <>
                      {humanMembers.length > 0 && (
                        <div>
                          <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-foreground">
                            People ({humanMembers.length})
                          </div>
                          {humanMembers.map((m) => {
                            const p = people.get(`human:${m.memberId}`);
                            const label = p?.name ?? `User ${m.memberId.slice(0, 8)}`;
                            const isSelf = m.memberId === selfUserId;
                            const isOnline = isSelf || presence[m.memberId]?.online === true;
                            return (
                              <MemberRow
                                key={`hm:${m.memberId}`}
                                href={`/s/${serverSlug}/people`}
                                avatar={p?.image ? (
                                  <img src={p.image} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
                                ) : (
                                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/10 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
                                    {label.slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                                primary={label + (isSelf ? " (you)" : "")}
                                secondary={p?.email ?? ""}
                                online={isOnline}
                                canRemove={canRemove && !isSelf}
                                onRemove={() => setRemoveTarget({ type: "human", id: m.memberId, label })}
                              />
                            );
                          })}
                        </div>
                      )}
                      {agentMembers.length > 0 && (
                        <div className={humanMembers.length > 0 ? "border-t" : ""}>
                          <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-foreground">
                            Agents ({agentMembers.length})
                          </div>
                          {agentMembers.map((m) => {
                            const a = agentsMap.get(`agent:${m.memberId}`);
                            const label = a?.displayName ?? `Agent ${m.memberId.slice(0, 8)}`;
                            return (
                              <MemberRow
                                key={`am:${m.memberId}`}
                                href={a ? `/s/${serverSlug}/agents/${a.id}` : undefined}
                                avatar={
                                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/10 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                    {label.slice(0, 1).toUpperCase()}
                                  </div>
                                }
                                primary={label}
                                secondary={a ? `${a.runtime} · @${a.name}` : ""}
                                online={a?.status === "online"}
                                canRemove={canRemove}
                                onRemove={() => setRemoveTarget({ type: "agent", id: m.memberId, label })}
                              />
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search people or agents"
                    autoFocus
                    className="pl-7"
                    placeholder="Search people or agents"
                    value={query}
                    onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
                  />
                </div>
                <div className="max-h-72 overflow-y-auto rounded-xl border border-border bg-[var(--surface-secondary)]">
                  {candidateHumans.length === 0 && candidateAgents.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                      {query ? "No matches." : "Everyone in the workspace is already in this channel."}
                    </p>
                  ) : (
                    <>
                      {candidateHumans.length > 0 && (
                        <div className="border-b">
                          <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-foreground">People</div>
                          {candidateHumans.map((m) => (
                            <PickerRow
                              key={`pu:${m.userId}`}
                              checked={selectedHumans.has(m.userId)}
                              onToggle={() => {
                                setSelectedHumans(prev => {
                                  const next = new Set(prev);
                                  if (next.has(m.userId)) next.delete(m.userId); else next.add(m.userId);
                                  return next;
                                });
                              }}
                              avatar={m.image ? (
                                <img src={m.image} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
                              ) : (
                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/10 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
                                  {m.name.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              primary={m.name}
                              secondary={m.email ?? ""}
                            />
                          ))}
                        </div>
                      )}
                      {candidateAgents.length > 0 && (
                        <div>
                          <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-foreground">Agents</div>
                          {candidateAgents.map((a) => (
                            <PickerRow
                              key={`pa:${a.id}`}
                              checked={selectedAgents.has(a.id)}
                              onToggle={() => {
                                setSelectedAgents(prev => {
                                  const next = new Set(prev);
                                  if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                                  return next;
                                });
                              }}
                              avatar={
                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/10 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                  {a.displayName.slice(0, 1).toUpperCase()}
                                </div>
                              }
                              primary={a.displayName}
                              secondary={`${a.runtime} · @${a.name}`}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {error && (
                  <p role="alert" className="text-sm text-danger-text">{error}</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setPickerOpen(false); setSelectedHumans(new Set()); setSelectedAgents(new Set()); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleAdd}
                    loading={busy}
                    disabled={selectedHumans.size + selectedAgents.size === 0}
                  >
                    Add {selectedHumans.size + selectedAgents.size > 0 ? selectedHumans.size + selectedAgents.size : ""}
                  </Button>
                </div>
              </div>
            )}
          </DialogPanel>
          {!pickerOpen && (
            <DialogFooter className="flex justify-end gap-2">
              <DialogClose render={<Button variant="outline" type="button">Close</Button>} />
            </DialogFooter>
          )}
        </DialogPopup>
      </DialogPortal>
      {removeTarget && (
        <ConfirmDialog
          open={true}
          onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
          title={`Remove ${removeTarget.label} from #${channel.name}?`}
          description="They lose access immediately. You can add them back at any time."
          confirmLabel="Remove"
          destructive
          busy={busy}
          onConfirm={performRemove}
        />
      )}
    </Dialog>
  );
}

function MemberRow({ avatar, primary, secondary, online, canRemove, onRemove, href }: {
  avatar: React.ReactNode; primary: string; secondary?: string;
  online?: boolean;
  canRemove: boolean; onRemove: () => void;
  /** Click target. Humans → /people, agents → /agents/[id]. Undefined =
   *  non-clickable row (when the agent record didn't resolve). */
  href?: string;
}) {
  // Avatar wrapped in a sized span so the presence dot can overlap the
  // bottom-right corner without affecting layout. inline-flex + size-6
  // pins both <img> and <div> avatars to the same baseline so the dot
  // position is consistent (codex PA2 LOW).
  const avatarWithDot = (
    <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center">
      {avatar}
      {online !== undefined && (
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-popover ${
            online ? "bg-success" : "bg-zinc-400/60"
          }`}
        />
      )}
    </span>
  );

  // Codex PA2 MED — Link wrapping a Remove <button> is invalid nested-
  // interactive HTML. Split them: the Link covers the avatar/text
  // (most of the row), Remove is a sibling button. CSS makes them
  // *look* like one row, semantics keep them separate for AT/axe.
  const linkContent = (
    <>
      {avatarWithDot}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{primary}</div>
        {secondary && (
          <div className="truncate text-[10.5px] text-foreground">{secondary}</div>
        )}
      </div>
    </>
  );

  return (
    <div className="group flex items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent/40">
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5 text-foreground outline-none focus-visible:underline">
          {linkContent}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">{linkContent}</div>
      )}
      {canRemove && (
        <Button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${primary}`}
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-danger-text"
        >
          <UserMinus className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function PickerRow({ checked, onToggle, avatar, primary, secondary }: {
  checked: boolean; onToggle: () => void; avatar: React.ReactNode;
  primary: string; secondary?: string;
}) {
  return (
    <Button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      variant="ghost"
      size="sm"
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
        checked ? "bg-cyan-500/10 text-foreground" : "hover:bg-accent/40"
      } text-foreground`}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{primary}</div>
        {secondary && (
          <div className="truncate text-[10.5px] text-foreground">{secondary}</div>
        )}
      </div>
      <span
        aria-hidden="true"
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          checked ? "border-foreground bg-foreground text-background" : "border-border"
        }`}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
    </Button>
  );
}

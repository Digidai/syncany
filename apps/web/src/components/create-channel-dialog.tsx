"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Hash, Lock, Search, X } from "lucide-react";
import {
  Dialog, DialogPortal, DialogBackdrop, DialogPopup,
  DialogHeader, DialogTitle, DialogPanel, DialogFooter, DialogClose,
} from "@/components/heroui-pro/dialog";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Field, FieldLabel } from "@/components/heroui-pro/field";
import { api, ApiError, type Agent } from "@/lib/api";

interface Props {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

/** Trimmed person + agent shapes used in the picker. Refetched each
 *  time the dialog opens; in-memory only — no React Query cache, since
 *  the workspace member list barely changes during a session and a
 *  fresh fetch beats stale data when the user just invited someone. */
type WorkspaceMember = { userId: string; name: string; email: string | null; image: string | null };

export function CreateChannelDialog({ serverId, open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"public" | "private">("public");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Picker data
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  // Reset all transient state each time the dialog opens — leftover
  // selections from a previous open are almost always a UX bug (user
  // expects a clean slate). Keep `name` blank too.
  useEffect(() => {
    if (!open) return;
    setName(""); setDescription(""); setType("public");
    setSelectedMembers(new Set()); setSelectedAgents(new Set());
    setQuery(""); setError(null);
    let cancelled = false;
    (async () => {
      try {
        const [m, a, me] = await Promise.all([
          api.listMembers(serverId),
          api.listAgents().then(r => r.agents.filter(ag => ag.serverId === serverId)),
          api.me(),
        ]);
        if (cancelled) return;
        setMyUserId(me.subject.userId ?? null);
        // Hide self from the picker — creator is always added by the
        // server, so showing them in the list creates a "why can't I
        // uncheck me?" UX trap.
        setMembers(m.members.filter(p => p.userId !== me.subject.userId).map(p => ({
          userId: p.userId, name: p.name, email: p.email, image: p.image,
        })));
        setAgents(a);
      } catch {
        if (cancelled) return;
        setMembers([]); setAgents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open, serverId]);

  const filteredMembers = useMemo(() => {
    if (!members) return [];
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(m =>
      m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q));
  }, [members, query]);
  const filteredAgents = useMemo(() => {
    if (!agents) return [];
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(a =>
      a.displayName.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  }, [agents, query]);

  const totalSelected = selectedMembers.size + selectedAgents.size;

  function toggleMember(id: string) {
    setSelectedMembers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAgent(id: string) {
    setSelectedAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true); setError(null);
    try {
      const res = await api.createChannel({
        serverId,
        name,
        description: description || undefined,
        type,
        initialMemberIds: selectedMembers.size > 0 ? [...selectedMembers] : undefined,
        initialAgentIds: selectedAgents.size > 0 ? [...selectedAgents] : undefined,
      });
      // Tell the sidebar to refetch so the new channel shows up
      // immediately. Same event the /channels page dispatches on join.
      window.dispatchEvent(new CustomEvent("raltic:channels-changed"));
      onCreated?.(res.id);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create channel</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <DialogPanel>
              <div className="space-y-4">
                <Field>
                  <FieldLabel htmlFor="channel-name">Name</FieldLabel>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {type === "private" ? <Lock className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />}
                    </span>
                    <Input
                      id="channel-name"
                      className="pl-7"
                      value={name}
                      required
                      pattern="[a-z0-9_-]+"
                      maxLength={64}
                      onChange={(e) => setName((e.target as HTMLInputElement).value.toLowerCase())}
                      placeholder="e.g. design-reviews"
                      autoFocus
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Lowercase letters, numbers, dashes, underscores. Up to 64 chars.
                  </p>
                </Field>
                <Field>
                  <FieldLabel htmlFor="channel-desc">Description <span className="text-muted-foreground">(optional)</span></FieldLabel>
                  <Input
                    id="channel-desc"
                    value={description}
                    onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
                    placeholder="What is this channel for?"
                    maxLength={2000}
                  />
                </Field>
                <Field>
                  <FieldLabel id="create-channel-visibility-label">Visibility</FieldLabel>
                  <div role="group" aria-labelledby="create-channel-visibility-label" className="flex flex-col gap-2 sm:flex-row">
                    {(["public", "private"] as const).map((t) => (
                      <Button key={t} type="button"
                        onClick={() => setType(t)}
                        aria-pressed={type === t}
                        variant="outline"
                        size="sm"
                        className={`!h-auto min-w-0 flex-1 flex-col !items-stretch !justify-start !whitespace-normal rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                          type === t ? "border-foreground bg-accent" : "border-border hover:bg-accent/40"
                        }`}>
                        <div className="flex items-center gap-2 font-medium">
                          {t === "public" ? <Hash className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                          {t === "public" ? "Public" : "Private"}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {t === "public"
                            ? "Anyone in the workspace can find and join."
                            : "Only invited members can see this channel."}
                        </div>
                      </Button>
                    ))}
                  </div>
                </Field>

                {/* Member / agent picker */}
                <Field>
                  <FieldLabel htmlFor="create-channel-member-search">
                    Add members <span className="text-muted-foreground">(optional)</span>
                    {totalSelected > 0 && (
                      <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium">
                        {totalSelected} selected
                      </span>
                    )}
                  </FieldLabel>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="create-channel-member-search"
                      className="pl-7"
                      placeholder="Search people or agents"
                      value={query}
                      onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
                    />
                  </div>
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border bg-[var(--surface-secondary)]">
                    {members === null || agents === null ? (
                      <p className="px-3 py-4 text-center text-xs text-muted-foreground">Loading…</p>
                    ) : filteredMembers.length === 0 && filteredAgents.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                        {query
                          ? "No matches."
                          : "You're the only one here — you can add members later."}
                      </p>
                    ) : (
                      <>
                        {filteredMembers.length > 0 && (
                          <div className="border-b">
                            <div className="px-3 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">People</div>
                            {filteredMembers.map((m) => (
                              <PickerRow
                                key={`u:${m.userId}`}
                                checked={selectedMembers.has(m.userId)}
                                onToggle={() => toggleMember(m.userId)}
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
                        {filteredAgents.length > 0 && (
                          <div>
                            <div className="px-3 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Agents</div>
                            {filteredAgents.map((a) => (
                              <PickerRow
                                key={`a:${a.id}`}
                                checked={selectedAgents.has(a.id)}
                                onToggle={() => toggleAgent(a.id)}
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
                  {totalSelected > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[...selectedMembers].map((id) => {
                        const m = members?.find(x => x.userId === id);
                        if (!m) return null;
                        return (
                          <SelectedChip key={`cu:${id}`} label={m.name} onRemove={() => toggleMember(id)} />
                        );
                      })}
                      {[...selectedAgents].map((id) => {
                        const a = agents?.find(x => x.id === id);
                        if (!a) return null;
                        return (
                          <SelectedChip key={`ca:${id}`} label={a.displayName} agent onRemove={() => toggleAgent(id)} />
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {myUserId
                      ? "You'll be added automatically. Add others now or invite them later from channel settings."
                      : "You'll be added automatically."}
                  </p>
                </Field>

                {error && (
                  <p role="alert" className="text-sm text-destructive-foreground">{error}</p>
                )}
              </div>
            </DialogPanel>
            <DialogFooter className="flex justify-end gap-2">
              <DialogClose render={<Button variant="outline" type="button">Cancel</Button>} />
              <Button type="submit" loading={loading}>Create channel</Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
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
        checked ? "bg-accent" : "hover:bg-accent/40"
      } text-foreground`}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{primary}</div>
        {secondary && (
          <div className="truncate text-[10.5px] text-muted-foreground">{secondary}</div>
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

function SelectedChip({ label, agent, onRemove }: { label: string; agent?: boolean; onRemove: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
      agent ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
    }`}>
      {label}
      <Button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        variant="ghost"
        size="icon-xs"
        className="h-5 w-5 hover:bg-black/10"
      >
        <X className="h-3 w-3" />
      </Button>
    </span>
  );
}

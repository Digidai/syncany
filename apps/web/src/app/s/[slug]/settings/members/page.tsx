"use client";

import { useCallback, useEffect, useState } from "react";
import { Users, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { notifySuccess, notifyThrown } from "@/lib/notify";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel } from "@raltic/ui/components/ui/card";
import { Button } from "@raltic/ui/components/ui/button";
import { Input } from "@raltic/ui/components/ui/input";
import { ConfirmDialog } from "@raltic/ui/components/ui/confirm-dialog";
import { InvitePresetButton, InviteRow, KeyCommandBlock } from "@/components/settings-shared";
import { useSettings, SettingsSection } from "../layout";

// Types match the API client return shapes exactly; rather than re-declare
// loose locals (and silence type drift with `as` casts) we infer from the
// client surfaces. If the API response narrows or widens, callers see it
// immediately at the call site.
type Member = Awaited<ReturnType<typeof api.listMembers>>["members"][number];
type Invite = Awaited<ReturnType<typeof api.listInvites>>["invites"][number];

export default function MembersSettingsPage() {
  const { server } = useSettings();
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [viewerRole, setViewerRole] = useState<string>("member");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);
  const [issuedInvite, setIssuedInvite] = useState<{ url: string } | null>(null);
  // Two parallel confirm flows (revoke invite + remove member). Each holds
  // the entity it's about to act on so the dialog body can name it; the
  // dialog itself is a single instance per flow.
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; name: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([
        api.listMembers(server.id),
        api.listInvites(server.id).catch(() => ({ invites: [] })),
      ]);
      setMembers(m.members);
      setViewerRole(m.viewerRole ?? "member");
      setInvites(i.invites);
    } catch (e) {
      notifyThrown("Couldn't load members", e);
    } finally {
      setMembersLoaded(true);
    }
  }, [server.id]);

  useEffect(() => { reload(); }, [reload]);

  const canManage = viewerRole === "owner" || viewerRole === "admin";

  async function handleCreateInvite(preset: { ttlHours: number; maxUses: number; label: string }) {
    try {
      const res = await api.createInvite({ serverId: server.id, ttlHours: preset.ttlHours, maxUses: preset.maxUses });
      setIssuedInvite({ url: res.url });
      try { await navigator.clipboard.writeText(res.url); notifySuccess("Link copied", preset.label); }
      catch { /* clipboard blocked → user can still hit Copy below */ }
      const i = await api.listInvites(server.id);
      setInvites(i.invites);
    } catch (e) {
      notifyThrown("Couldn't create invite", e);
    }
  }

  async function handleSendEmailInvite() {
    if (!inviteEmail.trim()) return;
    setSendingInvite(true);
    try {
      const res = await api.inviteByEmail({ serverId: server.id, email: inviteEmail.trim() });
      const i = await api.listInvites(server.id);
      setInvites(i.invites);
      setInviteEmail("");
      notifySuccess("Invite sent", `Email delivered to ${res.sentTo}`);
    } catch (e) {
      notifyThrown("Couldn't send invite", e);
    } finally {
      setSendingInvite(false);
    }
  }

  async function confirmRevokeInvite() {
    if (!revokeTarget) return;
    try {
      await api.revokeInvite(revokeTarget);
      const i = await api.listInvites(server.id);
      setInvites(i.invites);
    } catch (e) {
      notifyThrown("Couldn't revoke invite", e);
    } finally {
      setRevokeTarget(null);
    }
  }

  async function confirmRemoveMember() {
    if (!removeTarget) return;
    try {
      await api.removeMember(server.id, removeTarget.userId);
      reload();
      notifySuccess(`Removed ${removeTarget.name}`);
    } catch (e) {
      notifyThrown("Couldn't remove member", e);
    } finally {
      setRemoveTarget(null);
    }
  }

  return (
    <SettingsSection title="Members & invites" description="Who's in this workspace and how new people join.">
      {/* ── Invite ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> Invite people</CardTitle>
          <CardDescription>
            Email for a single person; share link for anyone with the URL.
          </CardDescription>
        </CardHeader>
        <CardPanel className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Invite by email</p>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail((e.target as HTMLInputElement).value)}
                className="flex-1"
              />
              <Button onClick={handleSendEmailInvite} disabled={!inviteEmail.includes("@") || sendingInvite || !canManage}>
                {sendingInvite ? "Sending…" : "Send invite"}
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sends a private link to that address only. Single-use, 24-hour expiry.
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Create a share link</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <InvitePresetButton
                title="Open link"
                detail="7 days · anyone who has it"
                onClick={() => handleCreateInvite({ ttlHours: 24 * 7, maxUses: 0, label: "Open link · 7 days · unlimited" })}
              />
              <InvitePresetButton
                title="Single-use link"
                detail="24 hours · one person only"
                onClick={() => handleCreateInvite({ ttlHours: 24, maxUses: 1, label: "Single-use link · 24 hours" })}
              />
              <InvitePresetButton
                title="Team link"
                detail="30 days · up to 25 people"
                onClick={() => handleCreateInvite({ ttlHours: 24 * 30, maxUses: 25, label: "Team link · 30 days · 25 max" })}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Pick a preset — we copy the link to your clipboard automatically.
            </p>
          </div>

          {issuedInvite && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-50 p-3 text-xs">
              <p className="mb-2 font-medium text-emerald-800">✓ Link copied — share it with whoever should join:</p>
              <KeyCommandBlock cmd={issuedInvite.url} />
            </div>
          )}

          {invites.filter(i => !i.revokedAt).length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Active links</p>
              <ul className="space-y-2">
                {invites.filter(i => !i.revokedAt).map((inv) => (
                  <InviteRow key={inv.id} invite={inv} onRevoke={() => setRevokeTarget(inv.id)} />
                ))}
              </ul>
            </div>
          )}
        </CardPanel>
      </Card>

      {/* ── Members list ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Members</CardTitle>
          <CardDescription>{members.length} {members.length === 1 ? "person" : "people"} in this workspace.</CardDescription>
        </CardHeader>
        <CardPanel>
          {!membersLoaded ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Couldn&apos;t load members.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
                  {m.image
                    ? <img src={m.image} alt="" className="h-8 w-8 rounded-full object-cover" />
                    : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/10 text-xs font-medium text-cyan-700">{m.name.slice(0, 1).toUpperCase()}</div>}
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{m.name}</div>
                    {m.email && <div className="truncate text-xs text-muted-foreground">{m.email}</div>}
                  </div>
                  <RoleBadge role={m.role} />
                  {canManage && m.role !== "owner" && (
                    <button
                      className="text-xs text-destructive-foreground hover:underline"
                      onClick={() => setRemoveTarget({ userId: m.userId, name: m.name })}
                    >Remove</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardPanel>
      </Card>

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}
        title="Revoke this invite link?"
        description="Anyone who has the link won't be able to join. Existing members keep their access."
        confirmLabel="Revoke link"
        onConfirm={confirmRevokeInvite}
      />
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
        title={removeTarget ? `Remove ${removeTarget.name}?` : "Remove member?"}
        description="They'll lose access to every channel in this workspace immediately. Their messages stay. They can rejoin only if invited again."
        confirmLabel="Remove member"
        onConfirm={confirmRemoveMember}
      />
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Role badge — distinct color per role so admin/owner stand out at a glance.
// Owner gets the accent treatment because there's exactly one per workspace
// and removing the wrong person here is the most consequential mistake.
// ---------------------------------------------------------------------------
function RoleBadge({ role }: { role: string }) {
  const styles =
    role === "owner"
      ? "bg-amber-500/15 text-amber-800 ring-amber-500/30"
      : role === "admin"
      ? "bg-cyan-500/10 text-cyan-700 ring-cyan-500/30"
      : "bg-zinc-100 text-zinc-700 ring-zinc-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ${styles}`}>
      {role}
    </span>
  );
}

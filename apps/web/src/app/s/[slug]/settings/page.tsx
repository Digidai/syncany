"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { notifyThrown, notifySuccess } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/ui/card";
import { CreateChannelDialog } from "@/components/create-channel-dialog";
import { CreateAgentDialog } from "@/components/create-agent-dialog";
import { EditAgentDialog } from "@/components/edit-agent-dialog";
import type { Agent } from "@/lib/api";
import Link from "next/link";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Hash, Cpu, KeyRound, Copy, UserPlus } from "lucide-react";

function KeyCommandBlock({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded border bg-zinc-900 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">terminal</span>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(cmd);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className={"flex items-center gap-1 rounded px-2 py-0.5 text-[11px] " +
            (copied ? "bg-emerald-600/20 text-emerald-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-white")}
        >
          <Copy className="h-3 w-3" />{copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[11px] leading-relaxed">{cmd}</pre>
    </div>
  );
}

interface Key {
  id: string; prefix: string; name: string;
  createdAt: number; lastUsedAt: number | null; revokedAt: number | null;
}

export default function SettingsPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [serverId, setServerId] = useState<string | null>(null);
  const [keys, setKeys] = useState<Key[]>([]);
  const [keyName, setKeyName] = useState("");
  const [issued, setIssued] = useState<{ apiKey: string; cmd: string } | null>(null);
  const [openChannel, setOpenChannel] = useState(false);
  const [openAgent, setOpenAgent] = useState(false);
  const [invites, setInvites] = useState<Array<{ id: string; uses: number; maxUses: number; expiresAt: number | null; revokedAt: number | null }>>([]);
  const [issuedInvite, setIssuedInvite] = useState<{ url: string } | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);
  const [members, setMembers] = useState<Array<{ userId: string; role: string; joinedAt: number; name: string; email: string | null; image: string | null }>>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [agentList, setAgentList] = useState<Agent[]>([]);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editAgentOpen, setEditAgentOpen] = useState(false);
  // Persistent inline copies of toast errors for form submissions —
  // toasts auto-dismiss after 7 s, but a failed Create/Upload often needs
  // a longer-lived hint right next to the input the user just touched.
  const [keyError, setKeyError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getServerBySlug(slug);
        setServerId(data.server.id);
        const [kData, iData, mData, agData] = await Promise.all([
          api.listMachineKeys(),
          api.listInvites(data.server.id).catch(() => ({ invites: [] })),
          api.listMembers(data.server.id).catch(() => ({ members: [] })),
          api.listAgents().catch(() => ({ agents: [] })),
        ]);
        setKeys(kData.keys as Key[]);
        setInvites(iData.invites as any);
        setMembers(mData.members);
        setMembersLoaded(true);
        setAgentList(agData.agents);
      } catch (e) {
        notifyThrown("Couldn't load settings", e);
        setMembersLoaded(true);
      }
    })();
  }, [slug]);

  async function reloadKeys() {
    const kData = await api.listMachineKeys();
    setKeys(kData.keys as Key[]);
  }

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!serverId || !keyName.trim()) return;
    setKeyError(null);
    try {
      const res = await api.createMachineKey({ serverId, name: keyName.trim() });
      const apiUrl = process.env.NEXT_PUBLIC_SYNCANY_API_URL ?? "https://api.syncany.app";
      setIssued({
        apiKey: res.apiKey,
        cmd: `npx -y @syncany/bridge --api-key ${res.apiKey} --server-url ${apiUrl}`,
      });
      setKeyName("");
      reloadKeys();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setKeyError(msg);
      notifyThrown("Couldn't create machine key", e);
    }
  }

  async function handleCreateInvite() {
    if (!serverId) return;
    try {
      const res = await api.createInvite({ serverId, ttlHours: 24 * 7, maxUses: 0 });
      setIssuedInvite({ url: res.url });
      const i = await api.listInvites(serverId);
      setInvites(i.invites as any);
    } catch (e) {
      notifyThrown("Couldn't create invite", e);
    }
  }

  async function handleSendEmailInvite() {
    if (!serverId || !inviteEmail.trim()) return;
    setSendingInvite(true);
    try {
      const res = await api.inviteByEmail({ serverId, email: inviteEmail.trim() });
      const i = await api.listInvites(serverId);
      setInvites(i.invites as any);
      setInviteEmail("");
      notifySuccess("Invite sent", `Email delivered to ${res.sentTo}`);
    } catch (e) {
      notifyThrown("Couldn't send invite", e);
    } finally {
      setSendingInvite(false);
    }
  }

  async function handleRemoveMember(userId: string, name: string) {
    if (!serverId) return;
    if (!confirm(`Remove ${name} from this workspace? They'll lose access to all channels.`)) return;
    try {
      await api.removeMember(serverId, userId);
      const m = await api.listMembers(serverId);
      setMembers(m.members);
    } catch (e) {
      notifyThrown("Couldn't remove member", e);
    }
  }

  async function handleRevokeInvite(id: string) {
    if (!confirm("Revoke this invite link?")) return;
    try {
      await api.revokeInvite(id);
      if (serverId) {
        const i = await api.listInvites(serverId);
        setInvites(i.invites as any);
      }
    } catch (e) {
      notifyThrown("Couldn't revoke invite", e);
    }
  }

  async function reloadAgents() {
    const r = await api.listAgents().catch(() => ({ agents: [] }));
    setAgentList(r.agents);
  }

  async function handleDeleteAgent(a: Agent) {
    if (!confirm(`Delete agent "${a.displayName}"?\n\nThis also removes its DM channel and any agent-channel memberships. The bridge will stop spawning a Claude Code process for it.`)) return;
    try {
      await api.deleteAgent(a.id);
      reloadAgents();
      notifySuccess(`Deleted ${a.displayName}`);
    } catch (e) {
      notifyThrown("Couldn't delete agent", e);
    }
  }

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    setUploadingAvatar(true);
    setAvatarError(null);
    try {
      const meta = await api.startAvatarUpload(file.type);
      const apiToken = await fetch("/api/me/api-token", { credentials: "include" }).then(r => r.json()).then((d: any) => d.token);
      const res = await fetch(meta.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, "Authorization": `Bearer sy_api_${apiToken}` },
        body: await file.arrayBuffer(),
      });
      if (!res.ok) throw new Error(await res.text());
      setAvatarUrl(meta.publicUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAvatarError(msg);
      notifyThrown("Avatar upload failed", e);
    } finally {
      setUploadingAvatar(false);
    }
  }

  if (!serverId) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-xl font-semibold">Workspace settings</h1>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Hash className="h-4 w-4" /> Channels</CardTitle>
            <CardDescription>Add new channels for your team.</CardDescription>
          </CardHeader>
          <CardPanel>
            <Button onClick={() => setOpenChannel(true)}>+ New channel</Button>
          </CardPanel>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Cpu className="h-4 w-4" /> Agents</CardTitle>
                <CardDescription>AI teammates that run on your laptop and join channels.</CardDescription>
              </div>
              <Button onClick={() => setOpenAgent(true)} size="sm">+ New agent</Button>
            </div>
          </CardHeader>
          <CardPanel>
            {agentList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agents yet. Click <span className="font-medium text-foreground">+ New agent</span> to add your first one.</p>
            ) : (
              <ul className="space-y-2">
                {agentList.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded border border-border p-3 text-sm">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${
                      a.status === "online" ? "bg-emerald-500" :
                      a.status === "sleeping" ? "bg-amber-500" : "bg-zinc-400"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{a.displayName}</span>
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{a.name}</span>
                        <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] capitalize text-cyan-700">{a.model}</span>
                      </div>
                      {a.description && <div className="truncate text-xs text-muted-foreground">{a.description}</div>}
                    </div>
                    {a.dmChannelId && (
                      <Link
                        href={`/s/${slug}/dm/${a.dmChannelId}`}
                        className="text-xs text-cyan-700 hover:underline"
                      >DM</Link>
                    )}
                    <button
                      className="text-xs text-foreground hover:underline"
                      onClick={() => { setEditingAgent(a); setEditAgentOpen(true); }}
                    >Edit</button>
                    <button
                      className="text-xs text-destructive-foreground hover:underline"
                      onClick={() => handleDeleteAgent(a)}
                    >Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </CardPanel>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> Invite people</CardTitle>
            <CardDescription>Send an email invite, or share a link to add humans to this workspace.</CardDescription>
          </CardHeader>
          <CardPanel className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail((e.target as HTMLInputElement).value)}
                className="flex-1"
              />
              <Button onClick={handleSendEmailInvite} disabled={!inviteEmail.includes("@") || sendingInvite}>
                {sendingInvite ? "Sending…" : "Send invite"}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">— or —</div>
            <Button onClick={handleCreateInvite} variant="outline">+ New invite link (7-day, unlimited uses)</Button>
            {issuedInvite && (
              <div className="mt-3 rounded-md border bg-emerald-50 p-3 text-xs">
                <p className="mb-2 font-medium text-emerald-800">Share this link:</p>
                <KeyCommandBlock cmd={issuedInvite.url} />
              </div>
            )}
            {invites.filter(i => !i.revokedAt).length > 0 && (
              <table className="mt-4 w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr><th className="text-left">Link</th><th className="text-left">Uses</th><th className="text-left">Expires</th><th /></tr>
                </thead>
                <tbody>
                  {invites.filter(i => !i.revokedAt).map((inv) => (
                    <tr key={inv.id} className="border-t">
                      <td className="py-1 font-mono text-[11px]">{`/invite/${inv.id.slice(0, 16)}…`}</td>
                      <td className="py-1">{inv.uses}{inv.maxUses ? ` / ${inv.maxUses}` : ""}</td>
                      <td className="py-1 text-xs text-muted-foreground">
                        {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : "never"}
                      </td>
                      <td className="py-1 text-right">
                        <button className="text-xs text-destructive-foreground hover:underline"
                          onClick={() => handleRevokeInvite(inv.id)}>Revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardPanel>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> Members</CardTitle>
            <CardDescription>People in this workspace.</CardDescription>
          </CardHeader>
          <CardPanel>
            {!membersLoaded ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground">Couldn&apos;t load members.</p>
            ) : (
              <ul className="space-y-2">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-3 text-sm">
                    {m.image
                      ? <img src={m.image} alt="" className="h-8 w-8 rounded-full object-cover" />
                      : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/10 text-xs font-medium text-cyan-700">{m.name.slice(0,1).toUpperCase()}</div>}
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{m.name}</div>
                      {m.email && <div className="truncate text-xs text-muted-foreground">{m.email}</div>}
                    </div>
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium capitalize">{m.role}</span>
                    {m.role !== "owner" && (
                      <button
                        className="text-xs text-destructive-foreground hover:underline"
                        onClick={() => handleRemoveMember(m.userId, m.name)}
                      >Remove</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardPanel>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile picture</CardTitle>
            <CardDescription>Upload a PNG/JPG/GIF/WebP under 2 MB.</CardDescription>
          </CardHeader>
          <CardPanel>
            <div className="flex items-center gap-3">
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <div className="h-16 w-16 rounded-full bg-zinc-200" />
              )}
              <input type="file" accept="image/*"
                onChange={(e) => handleAvatarChange((e.target as HTMLInputElement).files?.[0] ?? null)}
                disabled={uploadingAvatar}
                className="text-xs" />
              {uploadingAvatar && <span className="text-xs text-muted-foreground">Uploading…</span>}
            </div>
            {avatarError && (
              <p className="mt-2 text-xs text-destructive-foreground" role="alert">{avatarError}</p>
            )}
          </CardPanel>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Machine API keys</CardTitle>
            <CardDescription>Create one per laptop where you'll run the bridge.</CardDescription>
          </CardHeader>
          <form onSubmit={handleCreateKey}>
            <CardPanel>
              <Field>
                <FieldLabel>Key name</FieldLabel>
                <div className="flex gap-2">
                  <Input value={keyName} placeholder="e.g. macbook-pro"
                    onChange={(e) => { setKeyName((e.target as HTMLInputElement).value); if (keyError) setKeyError(null); }} />
                  <Button type="submit">Create</Button>
                </div>
                {keyError && <FieldError match>{keyError}</FieldError>}
              </Field>
            </CardPanel>
          </form>
          <CardFooter className="flex flex-col gap-3">
            {issued && (
              <div className="w-full space-y-2 rounded-md border bg-emerald-50 p-3 text-xs">
                <p className="font-medium text-emerald-800">
                  ✓ Key created. Copy it now — you won't see it again.
                </p>
                <KeyCommandBlock cmd={issued.cmd} />
              </div>
            )}
            {keys.length > 0 && (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr><th className="text-left">Prefix</th><th className="text-left">Name</th><th className="text-left">Created</th><th className="text-left">Last used</th><th /></tr>
                </thead>
                <tbody>
                  {keys.filter(k => !k.revokedAt).map((k) => (
                    <tr key={k.id} className="border-t">
                      <td className="py-1 font-mono">{k.prefix}…</td>
                      <td className="py-1">{k.name}</td>
                      <td className="py-1 text-xs text-muted-foreground">{new Date(k.createdAt).toLocaleDateString()}</td>
                      <td className="py-1 text-xs text-muted-foreground">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</td>
                      <td className="py-1 text-right">
                        <button
                          className="text-xs text-destructive-foreground hover:underline"
                          onClick={async () => {
                            if (!confirm(`Revoke key "${k.name}"? Bridges using it will disconnect.`)) return;
                            try { await api.revokeMachineKey(k.id); reloadKeys(); }
                            catch (e) { notifyThrown("Couldn't revoke key", e); }
                          }}
                        >Revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardFooter>
        </Card>

      </div>

      <CreateChannelDialog serverId={serverId} open={openChannel} onOpenChange={setOpenChannel}
        onCreated={() => location.reload()} />
      <CreateAgentDialog serverId={serverId} open={openAgent} onOpenChange={setOpenAgent}
        onCreated={() => { reloadAgents(); }} />
      <EditAgentDialog agent={editingAgent} open={editAgentOpen}
        onOpenChange={setEditAgentOpen}
        onSaved={() => { reloadAgents(); notifySuccess("Agent updated"); }} />
    </div>
  );
}

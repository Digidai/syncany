"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/ui/card";
import { CreateChannelDialog } from "@/components/create-channel-dialog";
import { CreateAgentDialog } from "@/components/create-agent-dialog";
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
        const [kData, iData] = await Promise.all([
          api.listMachineKeys(),
          api.listInvites(data.server.id).catch(() => ({ invites: [] })),
        ]);
        setKeys(kData.keys as Key[]);
        setInvites(iData.invites as any);
      } catch (e) {
        notifyThrown("Couldn't load settings", e);
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
      setIssued({
        apiKey: res.apiKey,
        cmd: `npx -y @syncany/bridge --api-key ${res.apiKey} --server-url https://api.syncany.app`,
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
            <CardTitle className="flex items-center gap-2"><Hash className="h-4 w-4" /> Channels & agents</CardTitle>
            <CardDescription>Add new channels and bring in additional AI agents.</CardDescription>
          </CardHeader>
          <CardPanel>
            <div className="flex gap-2">
              <Button onClick={() => setOpenChannel(true)}>+ New channel</Button>
              <Button onClick={() => setOpenAgent(true)} variant="outline">
                <Cpu className="mr-1 h-3.5 w-3.5" /> + New agent
              </Button>
            </div>
          </CardPanel>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> Invite people</CardTitle>
            <CardDescription>Share a link to add humans to this workspace.</CardDescription>
          </CardHeader>
          <CardPanel>
            <Button onClick={handleCreateInvite}>+ New invite link (7-day, unlimited uses)</Button>
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
                        <button className="text-xs text-red-600 hover:underline"
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
                          className="text-xs text-red-600 hover:underline"
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
        onCreated={() => location.reload()} />
    </div>
  );
}

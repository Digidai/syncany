"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { User as UserIcon, Mail, LogOut, ShieldCheck, Upload, Home } from "lucide-react";
import { authClient, signOut, useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { notifySuccess, notifyThrown } from "@/lib/notify";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel } from "@raltic/ui/components/ui/card";
import { Button } from "@raltic/ui/components/ui/button";
import { Input } from "@raltic/ui/components/ui/input";
import { Field, FieldLabel } from "@raltic/ui/components/ui/field";
import { SettingsSection } from "../layout";

// Personal account settings — scoped to the signed-in user, not the
// workspace. Same surface no matter which workspace is in the URL bar:
// display name (renames you across every workspace), email (read-only,
// shown so users can verify which account they're signed in as), sign-out.
export default function AccountSettingsPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Hydrate the form once the session resolves. We avoid hydrating on
  // every re-render so the input doesn't snap back if the user is mid-edit.
  useEffect(() => {
    if (session?.user.name) setDisplayName(session.user.name);
  }, [session?.user.name]);

  if (isPending || !session) {
    return (
      <SettingsSection title="Account">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </SettingsSection>
    );
  }

  const user = session.user;
  const dirty = displayName.trim().length > 0 && displayName.trim() !== user.name;

  async function handleSaveName() {
    if (!dirty) return;
    setSaving(true);
    try {
      const { error } = await authClient.updateUser({ name: displayName.trim() });
      if (error) throw new Error(error.message ?? "Couldn't update name");
      notifySuccess("Display name updated");
      // No router.refresh needed — useSession watches the cookie and the
      // next access will see the new name. Sidebar avatars derived from
      // `image` aren't touched here.
    } catch (e) {
      notifyThrown("Couldn't update name", e);
    } finally {
      setSaving(false);
    }
  }

  async function copyEmail() {
    if (!user.email) return;
    try {
      await navigator.clipboard.writeText(user.email);
      notifySuccess("Email copied");
    } catch {
      notifyThrown("Clipboard blocked", new Error("Browser refused clipboard access"));
    }
  }

  async function handleAvatarUpload(file: File | null) {
    if (!file || uploadingAvatar) return;
    if (file.size > 2 * 1024 * 1024) {
      notifyThrown("Avatar upload failed", new Error("File must be under 2 MB"));
      return;
    }
    setUploadingAvatar(true);
    try {
      // Default purpose = "avatar" → PUT handler also updates user.image
      // server-side. No follow-up updateUser() needed; better-auth's
      // useSession will pick up the new image on next refetch.
      const meta = await api.startAvatarUpload(file.type);
      const apiOrigin = (() => {
        try { return new URL(process.env.NEXT_PUBLIC_RALTIC_API_URL ?? "https://api.raltic.com").origin; }
        catch { return "https://api.raltic.com"; }
      })();
      const uploadOrigin = (() => { try { return new URL(meta.uploadUrl).origin; } catch { return ""; } })();
      const sameOrigin = uploadOrigin === apiOrigin;
      const headers: Record<string, string> = { "Content-Type": file.type };
      if (sameOrigin) {
        const tokRes = await fetch("/api/me/api-token", { credentials: "include" });
        const tokBody = (await tokRes.json()) as { token: string };
        headers["Authorization"] = `Bearer sy_api_${tokBody.token}`;
      }
      const res = await fetch(meta.uploadUrl, { method: "PUT", headers, body: await file.arrayBuffer() });
      if (!res.ok) throw new Error(await res.text());
      // Force useSession to refetch so the new avatar shows immediately
      // in this view + sidebar + everywhere user.image is rendered.
      await authClient.getSession({ query: { disableCookieCache: true } });
      notifySuccess("Avatar updated");
    } catch (e) {
      notifyThrown("Couldn't upload avatar", e);
    } finally {
      setUploadingAvatar(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/login");
    } catch (e) {
      notifyThrown("Sign out failed", e);
      setSigningOut(false);
    }
  }

  return (
    <SettingsSection title="Account" description="Your personal profile — shared across every workspace you're in.">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserIcon className="h-4 w-4" /> Profile</CardTitle>
          <CardDescription>How teammates see you in messages and mentions.</CardDescription>
        </CardHeader>
        <CardPanel>
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              {user.image ? (
                <img src={user.image} alt="Your avatar" className="h-16 w-16 rounded-full object-cover ring-1 ring-border" referrerPolicy="no-referrer" loading="lazy" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-500/10 text-2xl font-semibold text-cyan-700">
                  {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              {/* Upload affordance under the avatar — same vertical rhythm
                  as the Workspace tab's icon uploader so the two screens
                  feel like one design language. */}
              <label
                className="mt-2 flex cursor-pointer items-center justify-center gap-1 text-[10.5px] text-cyan-700 hover:underline aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                aria-disabled={uploadingAvatar}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  disabled={uploadingAvatar}
                  onChange={(e) => handleAvatarUpload(e.target.files?.[0] ?? null)}
                />
                <Upload className="h-3 w-3" aria-hidden="true" />
                {uploadingAvatar ? "Uploading…" : "Change"}
              </label>
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <Field>
                <FieldLabel>Display name</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                    maxLength={120}
                    placeholder="Your name"
                  />
                  <Button onClick={handleSaveName} disabled={!dirty || saving} loading={saving} size="sm">
                    Save
                  </Button>
                </div>
              </Field>
            </div>
          </div>
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Email</CardTitle>
          <CardDescription>The address you sign in with. Changing it requires re-verification (coming soon).</CardDescription>
        </CardHeader>
        <CardPanel>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate font-mono text-sm" title={user.email ?? undefined}>
              {user.email ?? "no email"}
            </span>
            {user.emailVerified ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                <ShieldCheck className="h-3 w-3" /> verified
              </span>
            ) : (
              <span className="text-[11px] text-amber-700">unverified</span>
            )}
            {user.email && (
              <button onClick={copyEmail} className="text-xs text-muted-foreground hover:text-foreground">
                Copy
              </button>
            )}
          </div>
        </CardPanel>
      </Card>

      <DefaultWorkspaceCard />

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>Sign out of this browser. Other sessions stay active.</CardDescription>
        </CardHeader>
        <CardPanel>
          <Button
            variant="outline"
            onClick={handleSignOut}
            loading={signingOut}
            disabled={signingOut}
          >
            <LogOut className="me-1.5 h-4 w-4" /> Sign out
          </Button>
        </CardPanel>
      </Card>
    </SettingsSection>
  );
}

// Default workspace = where the user lands after signing in (root `/`
// redirects here, the setup wizard targets it). Editing here mirrors
// the star button in the sidebar workspace switcher — both write to
// PATCH /api/v1/me/default-server. We keep this surface for users who
// look in Settings → Account when configuring their account.
function DefaultWorkspaceCard() {
  const [servers, setServers] = useState<Awaited<ReturnType<typeof api.me>>["servers"]>([]);
  const [defaultServerId, setDefaultServerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        setServers(me.servers);
        setDefaultServerId(me.defaultServerId);
      } catch (e) {
        notifyThrown("Couldn't load workspaces", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleChange(nextId: string) {
    if (nextId === defaultServerId) return;
    setPending(nextId);
    try {
      await api.setDefaultServer(nextId);
      setDefaultServerId(nextId);
      notifySuccess("Default workspace updated");
    } catch (e) {
      notifyThrown("Couldn't update default workspace", e);
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Home className="h-4 w-4" /> Default workspace</CardTitle>
        <CardDescription>
          The workspace you land on after signing in, and the one the setup
          wizard targets.
        </CardDescription>
      </CardHeader>
      <CardPanel>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No workspaces yet.</p>
        ) : (
          <ul className="space-y-1">
            {servers.map((s) => {
              const checked = s.id === defaultServerId;
              const isPending = pending === s.id;
              return (
                <li key={s.id}>
                  <label className={"flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors " + (checked ? "border-cyan-500/40 bg-cyan-500/5" : "hover:bg-accent/50")}>
                    <input
                      type="radio"
                      name="default-workspace"
                      checked={checked}
                      onChange={() => handleChange(s.id)}
                      disabled={isPending}
                      className="h-3.5 w-3.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        /{s.slug} · {s.role}
                      </div>
                    </div>
                    {isPending && <span className="text-[11px] text-muted-foreground">Saving…</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </CardPanel>
    </Card>
  );
}

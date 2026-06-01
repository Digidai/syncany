"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Upload, LogOut, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { notifySuccess, notifyThrown } from "@/lib/notify";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel } from "@/components/heroui-pro/card";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Field, FieldLabel } from "@/components/heroui-pro/field";
import { ConfirmDialog } from "@/components/heroui-pro/confirm-dialog";
import { useSettings, SettingsSection } from "../layout";
import { getApiOrigin } from "@/lib/auth-client";

export default function WorkspaceSettingsPage() {
  const { server, refreshServer } = useSettings();
  const router = useRouter();
  const canEdit = server.role === "owner" || server.role === "admin";
  const isOwner = server.role === "owner";

  // ── Identity (name + slug) ──────────────────────────────────────────────
  const [name, setName] = useState(server.name);
  const [slug, setSlug] = useState(server.slug);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [savingIdentity, setSavingIdentity] = useState(false);
  useEffect(() => { setName(server.name); }, [server.name]);
  useEffect(() => { setSlug(server.slug); setSlugError(null); }, [server.slug]);

  // Mirror the server's regex client-side for live feedback. Spec:
  //   6-48 chars, lowercase a-z + digits + hyphens, no leading/trailing hyphen.
  // We surface the rule inline rather than only at submit time so the user
  // gets immediate signal when they type "Acme" or "ab".
  function validateSlug(candidate: string): string | null {
    if (candidate === server.slug) return null;
    if (candidate.length < 6) return "Must be at least 6 characters";
    if (candidate.length > 48) return "Must be at most 48 characters";
    if (!/^[a-z0-9-]+$/.test(candidate)) return "Lowercase letters, digits, and hyphens only";
    if (candidate.startsWith("-") || candidate.endsWith("-")) return "Can't start or end with a hyphen";
    return null;
  }

  const slugDirty = slug !== server.slug;
  const nameDirty = name.trim().length > 0 && name.trim() !== server.name;
  const dirty = slugDirty || nameDirty;
  const liveSlugError = slugDirty ? validateSlug(slug) : null;
  const canSubmit = dirty && !liveSlugError && !savingIdentity;

  async function handleSaveIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSavingIdentity(true);
    setSlugError(null);
    try {
      const patch: Parameters<typeof api.updateServer>[1] = {};
      if (nameDirty) patch.name = name.trim();
      if (slugDirty) patch.slug = slug;
      const res = await api.updateServer(server.id, patch);
      // If slug changed, the current URL is now stale — redirect to the
      // new path so the route segment matches. The settings layout will
      // re-mount with the new slug.
      if (slugDirty && res.server.slug !== server.slug) {
        notifySuccess("Workspace URL updated", `/s/${res.server.slug}`);
        router.replace(`/s/${res.server.slug}/settings/workspace`);
        return;
      }
      await refreshServer();
      notifySuccess(nameDirty && slugDirty ? "Workspace updated" : nameDirty ? "Workspace renamed" : "Workspace URL updated");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Surface slug-specific errors inline; everything else as toast.
      if (/SLUG_TAKEN|already in use/i.test(msg)) {
        setSlugError("That URL is already taken — pick another.");
      } else if (/RESERVED_SLUG|reserved/i.test(msg)) {
        setSlugError("That URL is reserved. Try a different one.");
      } else {
        notifyThrown("Couldn't update workspace", e);
      }
    } finally {
      setSavingIdentity(false);
    }
  }

  // ── Icon upload ─────────────────────────────────────────────────────────
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleIconUpload(file: File | null) {
    if (!file || !canEdit) return;
    // Synchronous in-flight guard: rapid double-onChange (user re-selects
    // before React re-renders the disabled input) would otherwise start a
    // second upload, orphan the first R2 object, and write whichever URL
    // returned last. `uploading` state lags one render; check both.
    if (uploading) return;
    if (file.size > 2 * 1024 * 1024) {
      notifyThrown("Icon upload failed", new Error("File must be under 2 MB"));
      return;
    }
    setUploading(true);
    try {
      // CRITICAL: pass "server_icon" — without it the upload PUT handler
      // would unconditionally rewrite user.image to the workspace icon,
      // clobbering the uploader's personal avatar.
      const meta = await api.startAvatarUpload(file.type, "server_icon");
      // Same-origin guard from the prior implementation — never leak our
      // bearer token to a third-party (R2) presigned URL host.
      const apiOrigin = getApiOrigin();
      const uploadOrigin = (() => { try { return new URL(meta.uploadUrl).origin; } catch { return ""; } })();
      const sameOrigin = uploadOrigin === apiOrigin;

      const headers: Record<string, string> = { "Content-Type": file.type };
      if (sameOrigin) {
        const tokRes = await fetch("/api/me/api-token", { credentials: "include" });
        const tokBody = (await tokRes.json()) as { token: string };
        headers["Authorization"] = `Bearer sy_api_${tokBody.token}`;
      }

      const res = await fetch(meta.uploadUrl, {
        method: "PUT",
        headers,
        body: await file.arrayBuffer(),
      });
      if (!res.ok) throw new Error(await res.text());
      // Now persist on the server record — this is the bit the old page
      // never did, so uploads stayed local-only and vanished on reload.
      await api.updateServer(server.id, { iconUrl: meta.publicUrl });
      await refreshServer();
      notifySuccess("Workspace icon updated");
    } catch (e) {
      notifyThrown("Couldn't update icon", e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemoveIcon() {
    if (!canEdit || !server.iconUrl) return;
    try {
      await api.updateServer(server.id, { iconUrl: null });
      await refreshServer();
      notifySuccess("Workspace icon removed");
    } catch (e) {
      notifyThrown("Couldn't remove icon", e);
    }
  }

  // ── Leave (members) / Delete (owner) ────────────────────────────────────
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function handleLeave(): Promise<boolean> {
    try {
      await api.leaveServer(server.id);
      notifySuccess("Left workspace");
      router.push("/");
      return true;
    } catch (e) {
      notifyThrown("Couldn't leave workspace", e);
      return false;
    }
  }

  async function handleDelete(): Promise<boolean> {
    try {
      await api.deleteServer(server.id);
      notifySuccess("Workspace deleted");
      router.push("/");
      return true;
    } catch (e) {
      notifyThrown("Couldn't delete workspace", e);
      return false;
    }
  }

  return (
    <SettingsSection title="Workspace" description="Basic info, identity, and lifecycle for this workspace.">
      {/* ── Identity (name + icon) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Identity</CardTitle>
          <CardDescription>
            Workspace name + icon appear in the sidebar header and in invite previews.
          </CardDescription>
        </CardHeader>
        <CardPanel>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0 self-start">
              {server.iconUrl ? (
                <img
                  src={server.iconUrl}
                  alt={`${server.name} icon`}
                  className="h-16 w-16 rounded-2xl object-cover ring-1 ring-border"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-500/10 text-2xl font-semibold text-cyan-700">
                  {server.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="mt-2 flex flex-col items-center gap-1 text-[10.5px]">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 py-1"
                  disabled={!canEdit || uploading}
                  onPress={() => {
                    if (!canEdit || uploading) return;
                    fileRef.current?.click();
                  }}
                >
                  <Upload className="h-3 w-3" aria-hidden="true" />
                  <span>{uploading ? "Uploading…" : "Upload"}</span>
                </Button>
                <Input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  disabled={!canEdit || uploading}
                  unstyled
                  onChange={(e) => handleIconUpload(e.target.files?.[0] ?? null)}
                />
                {server.iconUrl && canEdit && (
                  <Button type="button" onClick={handleRemoveIcon} variant="ghost" size="xs" className="text-danger-text">
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <form onSubmit={handleSaveIdentity} className="min-w-0 w-full flex-1 space-y-3">
              <Field>
                <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
                <Input
                  id="workspace-name"
                  value={name}
                  onChange={(e) => setName((e.target as HTMLInputElement).value)}
                  maxLength={120}
                  disabled={!canEdit}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="workspace-slug">URL</FieldLabel>
                {/* Inline-prefix input: the "/s/" prefix is visual, the
                    user only edits the slug. Auto-lowercases on input so
                    the user can't accidentally type "Acme" and hit the
                    validator on submit. */}
                <div
                  className={[
                    "flex min-h-9 w-full items-stretch overflow-hidden rounded-md border",
                    "bg-[var(--field-background)] shadow-[var(--field-shadow)] transition-[border-color,box-shadow]",
                    liveSlugError || slugError
                      ? "border-destructive/60"
                      : "border-[var(--field-border)] hover:border-[var(--field-border-hover)]",
                    "focus-within:border-[var(--field-border-focus)] focus-within:ring-2",
                    "focus-within:ring-[color-mix(in_srgb,var(--accent)_14%,transparent)]",
                  ].join(" ")}
                >
                  <span className="flex min-h-9 shrink-0 items-center border-r border-[var(--field-border)] bg-[var(--surface-secondary)] px-3 font-mono text-sm font-medium text-muted-foreground select-none">
                    /s/
                  </span>
                  <Input
                    id="workspace-slug"
                    type="text"
                    value={slug}
                    onChange={(e) => {
                      const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                      setSlug(v);
                      if (slugError) setSlugError(null);
                    }}
                    disabled={!canEdit}
                    maxLength={48}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={!!(liveSlugError || slugError)}
                    aria-describedby="slug-hint"
                    unstyled
                    className="min-h-9 min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm text-foreground outline-none disabled:text-muted-foreground disabled:opacity-100 disabled:[-webkit-text-fill-color:var(--muted-foreground)]"
                  />
                </div>
                <p id="slug-hint" className={`mt-1 text-[11px] ${liveSlugError || slugError ? "text-danger-text" : "text-muted-foreground"}`}>
                  {liveSlugError ?? slugError ?? "6–48 chars · lowercase letters, digits, hyphens. Changing this breaks old invite links."}
                </p>
              </Field>
              {canEdit && (
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    loading={savingIdentity}
                    disabled={!canSubmit}
                  >
                    Save changes
                  </Button>
                </div>
              )}
              {!canEdit && (
                <p className="text-[11px] text-muted-foreground">
                  Only the workspace owner or admins can edit identity.
                </p>
              )}
            </form>
          </div>
        </CardPanel>
      </Card>

      {/* ── Danger zone ── */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-danger-text">Danger zone</CardTitle>
          <CardDescription>
            Irreversible actions. {isOwner ? "Delete cascades to every channel, message, and bridge key." : "Leaving removes you from every channel here."}
          </CardDescription>
        </CardHeader>
        <CardPanel className="space-y-3">
          {!isOwner && (
            <Card className="border-transparent bg-[var(--surface-secondary)] !shadow-none">
              <CardPanel className="flex flex-col items-start justify-between gap-3 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Leave this workspace</div>
                  <p className="text-[11px] text-muted-foreground">
                    Your messages and agents stay; you just lose access. You can rejoin only if someone invites you again.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setLeaveOpen(true)} className="w-full shrink-0 sm:w-auto">
                  <LogOut className="me-1 h-3.5 w-3.5" /> Leave
                </Button>
              </CardPanel>
            </Card>
          )}
          {isOwner && (
            <Card className="border-destructive/30 bg-destructive/5 !shadow-none">
              <CardPanel className="flex flex-col items-start justify-between gap-3 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-danger-text">Delete workspace</div>
                  <p className="text-[11px] text-muted-foreground">
                    Permanent. Removes every channel, message, agent, invite, and bridge key.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)} className="w-full shrink-0 border-destructive/40 text-danger-text hover:bg-destructive/10 sm:w-auto">
                  <Trash2 className="me-1 h-3.5 w-3.5" /> Delete
                </Button>
              </CardPanel>
            </Card>
          )}
        </CardPanel>
      </Card>

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Leave this workspace?"
        description={`You'll lose access to ${server.name} immediately. Channels you posted in will keep your messages, but you won't see them.`}
        confirmLabel="Leave workspace"
        onConfirm={async () => {
          if (await handleLeave()) setLeaveOpen(false);
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this workspace?"
        description={`This will permanently delete ${server.name} along with every channel, message, agent, and bridge key.`}
        confirmLabel="Delete forever"
        requireText={server.name}
        onConfirm={async () => {
          if (await handleDelete()) setDeleteOpen(false);
        }}
      />
    </SettingsSection>
  );
}

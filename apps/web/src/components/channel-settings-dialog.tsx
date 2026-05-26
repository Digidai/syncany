"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Hash, Lock, Trash2, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogPortal, DialogBackdrop, DialogPopup,
  DialogHeader, DialogTitle, DialogPanel, DialogFooter, DialogClose,
} from "@/components/heroui-pro/dialog";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Field, FieldLabel } from "@/components/heroui-pro/field";
import { ConfirmDialog } from "@/components/heroui-pro/confirm-dialog";
import { api, ApiError, type Channel } from "@/lib/api";
import { notifySuccess, notifyThrown } from "@/lib/notify";

interface Props {
  channel: Channel;
  serverSlug: string;
  /** True if the viewer is allowed to rename/delete (creator or workspace owner).
   *  Caller computes this from the API response so the dialog stays dumb. */
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful rename/desc edit, so the parent can
   *  re-fetch and re-render the channel header without a full reload. */
  onSaved?: () => void;
}

export function ChannelSettingsDialog({ channel, serverSlug, canManage, open, onOpenChange, onSaved }: Props) {
  const router = useRouter();
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description ?? "");
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [convertingVisibility, setConvertingVisibility] = useState(false);
  const [visibilityTarget, setVisibilityTarget] = useState<"public" | "private" | null>(null);

  // Reset edit + delete state every time the dialog opens, so a
  // half-typed delete confirmation from a previous session doesn't
  // linger.
  useEffect(() => {
    if (!open) return;
    setName(channel.name); setDescription(channel.description ?? "");
    setTopic(channel.topic ?? "");
    setError(null); setConfirmDelete(false); setDeleteText("");
    setVisibilityTarget(null);
  }, [open, channel.name, channel.description, channel.topic]);

  const dirty = canManage && (
    name.trim() !== channel.name
    || (description.trim() || null) !== (channel.description ?? null)
    || (topic.trim() || null) !== (channel.topic ?? null)
  );

  async function handleSave() {
    if (saving || !dirty) return;
    setSaving(true); setError(null);
    try {
      await api.updateChannel(channel.id, {
        name: name.trim() !== channel.name ? name.trim() : undefined,
        description: (description.trim() || null) !== (channel.description ?? null)
          ? (description.trim() || null)
          : undefined,
        topic: (topic.trim() || null) !== (channel.topic ?? null)
          ? (topic.trim() || null)
          : undefined,
      });
      notifySuccess("Channel updated");
      // Notify sidebar so the renamed channel surfaces immediately —
      // the message-area header refetches via onSaved but the sidebar
      // listens to this CustomEvent for its own re-fetch.
      window.dispatchEvent(new CustomEvent("raltic:channels-changed"));
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting || deleteText !== channel.name) return;
    setDeleting(true);
    try {
      await api.deleteChannel(channel.id);
      notifySuccess(`#${channel.name} deleted`);
      window.dispatchEvent(new CustomEvent("raltic:channels-changed"));
      onOpenChange(false);
      // Punt back to workspace root — channel page is gone.
      router.push(`/s/${serverSlug}`);
    } catch (e) {
      notifyThrown("Couldn't delete channel", e);
    } finally {
      setDeleting(false);
    }
  }

  function handleDialogOpenChange(next: boolean) {
    if (!next) setVisibilityTarget(null);
    onOpenChange(next);
  }

  async function confirmVisibilityChange() {
    const target = visibilityTarget;
    if (!target || target === channel.type) {
      setVisibilityTarget(null);
      return;
    }
    setConvertingVisibility(true);
    try {
      await api.setChannelVisibility(channel.id, target);
      notifySuccess(`Channel is now ${target}`);
      window.dispatchEvent(new CustomEvent("raltic:channels-changed"));
      onSaved?.();
      setVisibilityTarget(null);
      onOpenChange(false);
    } catch (e) {
      notifyThrown("Couldn't change visibility", e);
    } finally {
      setConvertingVisibility(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Channel settings</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor="cs-name">Name</FieldLabel>
                <Input
                  id="cs-name"
                  value={name}
                  pattern="[a-z0-9_-]+"
                  maxLength={64}
                  disabled={!canManage}
                  onChange={(e) => setName((e.target as HTMLInputElement).value.toLowerCase())}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="cs-desc">Description</FieldLabel>
                <Input
                  id="cs-desc"
                  value={description}
                  maxLength={2000}
                  disabled={!canManage}
                  onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
                  placeholder="What is this channel for?"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Permanent purpose. Set once.</p>
              </Field>
              <Field>
                <FieldLabel htmlFor="cs-topic">Current topic</FieldLabel>
                <Input
                  id="cs-topic"
                  value={topic}
                  maxLength={250}
                  disabled={!canManage}
                  onChange={(e) => setTopic((e.target as HTMLInputElement).value)}
                  placeholder="What's the focus right now?"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Short, changes as work shifts.</p>
              </Field>
              {channel.type !== "dm" && canManage && (
                <Field>
                  <FieldLabel id="channel-settings-visibility-label">Visibility</FieldLabel>
                  <div role="group" aria-labelledby="channel-settings-visibility-label" className="flex flex-col gap-2 sm:flex-row">
                    {(["public", "private"] as const).map((t) => (
                      <Button
                        key={t}
                        type="button"
                        disabled={convertingVisibility || visibilityTarget !== null || channel.type === t}
                        onClick={() => {
                          if (channel.type !== t) setVisibilityTarget(t);
                        }}
                        aria-pressed={channel.type === t}
                        variant="outline"
                        size="sm"
                        className={`flex-1 rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
                          channel.type === t ? "border-foreground bg-accent" : "border-border hover:bg-accent/40"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 font-medium">
                          {t === "public" ? <Hash className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                          {t === "public" ? "Public" : "Private"}
                        </span>
                      </Button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Existing members keep access on convert. For a fresh start, create a new private channel instead.
                  </p>
                </Field>
              )}
              {!canManage && (
                <p className="text-[11px] text-muted-foreground">
                  Only the channel creator or workspace owner can edit these.
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive-foreground">{error}</p>
              )}

              {/* Archive — softer than delete; reversible */}
              {canManage && channel.type !== "dm" && (
                <div className="rounded-md border bg-muted/40 p-3">
                  <div className="flex items-start gap-2">
                    {channel.archivedAt != null
                      ? <ArchiveRestore className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      : <Archive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    <div className="flex-1 text-xs">
                      <p className="font-medium">
                        {channel.archivedAt != null ? "Channel is archived" : "Archive channel"}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        {channel.archivedAt != null
                          ? "Posting is disabled and the channel is hidden from sidebars. Existing messages are preserved."
                          : "Make the channel read-only and hide it from sidebars. Reversible — no data is lost."}
                      </p>
                      <Button
                        type="button"
                        disabled={archiving}
                        onClick={async () => {
                          if (archiving) return;
                          setArchiving(true);
                          try {
                            if (channel.archivedAt != null) {
                              await api.unarchiveChannel(channel.id);
                              notifySuccess(`#${channel.name} restored`);
                            } else {
                              await api.archiveChannel(channel.id);
                              notifySuccess(`#${channel.name} archived`);
                            }
                            window.dispatchEvent(new CustomEvent("raltic:channels-changed"));
                            onSaved?.();
                            onOpenChange(false);
                          } catch (e) {
                            notifyThrown("Couldn't update archive state", e);
                          } finally {
                            setArchiving(false);
                          }
                        }}
                        variant="outline"
                        size="xs"
                        className="mt-2 text-[11px]"
                      >
                        {channel.archivedAt != null
                          ? <><ArchiveRestore className="h-3 w-3" />Unarchive</>
                          : <><Archive className="h-3 w-3" />Archive</>}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Danger zone */}
              {canManage && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-foreground" />
                    <div className="flex-1 text-xs">
                      <p className="font-medium text-destructive-foreground">Delete channel</p>
                      <p className="mt-0.5 text-muted-foreground">
                        All messages, tasks, and reactions in <strong>#{channel.name}</strong> will be permanently removed. Members will lose access immediately.
                      </p>
                      {!confirmDelete ? (
                        <Button
                          type="button"
                          onClick={() => setConfirmDelete(true)}
                          variant="danger-soft"
                          size="xs"
                          className="mt-2 text-[11px]"
                        >
                          <Trash2 className="h-3 w-3" /> Delete channel
                        </Button>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <label htmlFor="cs-del" className="text-[11px] text-muted-foreground">
                            Type <strong>{channel.name}</strong> to confirm.
                          </label>
                          <Input
                            id="cs-del"
                            value={deleteText}
                            onChange={(e) => setDeleteText((e.target as HTMLInputElement).value)}
                            placeholder={channel.name}
                          />
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full sm:w-auto"
                              onClick={() => { setConfirmDelete(false); setDeleteText(""); }}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              loading={deleting}
                              disabled={deleteText !== channel.name}
                              className="w-full sm:w-auto"
                              onClick={handleDelete}
                            >
                              Delete forever
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </DialogPanel>
          <DialogFooter className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" type="button">Close</Button>} />
            {canManage && (
              <Button type="button" onClick={handleSave} loading={saving} disabled={!dirty}>
                Save changes
              </Button>
            )}
          </DialogFooter>
        </DialogPopup>
      </DialogPortal>
      <ConfirmDialog
        open={visibilityTarget !== null}
        onOpenChange={(next) => {
          if (!next && !convertingVisibility) setVisibilityTarget(null);
        }}
        title={visibilityTarget ? `Convert #${channel.name} to ${visibilityTarget}?` : "Convert channel visibility?"}
        description="Existing members keep access. For a fresh private space, create a new private channel instead."
        confirmLabel={visibilityTarget ? `Convert to ${visibilityTarget}` : "Convert"}
        destructive={false}
        onConfirm={confirmVisibilityChange}
      />
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogPortal, DialogBackdrop, DialogPopup,
  DialogHeader, DialogTitle, DialogPanel, DialogFooter, DialogClose,
} from "@raltic/ui/components/ui/dialog";
import { Button } from "@raltic/ui/components/ui/button";
import { Input } from "@raltic/ui/components/ui/input";
import { Field, FieldLabel } from "@raltic/ui/components/ui/field";
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Reset edit + delete state every time the dialog opens, so a
  // half-typed delete confirmation from a previous session doesn't
  // linger.
  useEffect(() => {
    if (!open) return;
    setName(channel.name); setDescription(channel.description ?? "");
    setError(null); setConfirmDelete(false); setDeleteText("");
  }, [open, channel.name, channel.description]);

  const dirty = canManage && (name.trim() !== channel.name || (description.trim() || null) !== (channel.description ?? null));

  async function handleSave() {
    if (saving || !dirty) return;
    setSaving(true); setError(null);
    try {
      await api.updateChannel(channel.id, {
        name: name.trim() !== channel.name ? name.trim() : undefined,
        description: (description.trim() || null) !== (channel.description ?? null)
          ? (description.trim() || null)
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              </Field>
              {!canManage && (
                <p className="text-[11px] text-muted-foreground">
                  Only the channel creator or workspace owner can edit these.
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive-foreground">{error}</p>
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
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(true)}
                          className="mt-2 inline-flex items-center gap-1 rounded border border-destructive/50 px-2 py-1 text-[11px] font-medium text-destructive-foreground hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3 w-3" /> Delete channel
                        </button>
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
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
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
    </Dialog>
  );
}

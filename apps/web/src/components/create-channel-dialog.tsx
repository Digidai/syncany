"use client";

import { useState } from "react";
import {
  Dialog, DialogPortal, DialogBackdrop, DialogPopup,
  DialogHeader, DialogTitle, DialogPanel, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";

interface Props {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

export function CreateChannelDialog({ serverId, open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"public" | "private">("public");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await api.createChannel({
        serverId, name, description: description || undefined, type,
      });
      onCreated?.(res.id);
      onOpenChange(false);
      setName(""); setDescription(""); setType("public");
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
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Create channel</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <DialogPanel>
              <div className="space-y-4">
                <Field>
                  <FieldLabel>Name</FieldLabel>
                  <Input value={name} required pattern="[a-z0-9_-]+" maxLength={64}
                    onChange={(e) => setName((e.target as HTMLInputElement).value.toLowerCase())}
                    placeholder="general" />
                </Field>
                <Field>
                  <FieldLabel>Description</FieldLabel>
                  <Input value={description}
                    onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
                    placeholder="What is this channel for?" />
                </Field>
                <Field>
                  <FieldLabel>Type</FieldLabel>
                  <div className="flex gap-2">
                    {(["public", "private"] as const).map((t) => (
                      <button key={t} type="button"
                        onClick={() => setType(t)}
                        className={`rounded border px-3 py-1 text-sm ${type === t ? "border-foreground bg-accent" : "border-border"}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </Field>
                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>
            </DialogPanel>
            <DialogFooter className="flex justify-end gap-2">
              <DialogClose render={<Button variant="outline" type="button">Cancel</Button>} />
              <Button type="submit" loading={loading}>Create</Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

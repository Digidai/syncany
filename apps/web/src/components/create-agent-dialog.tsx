"use client";

import { useState } from "react";
import {
  Dialog, DialogPortal, DialogBackdrop, DialogPopup,
  DialogHeader, DialogTitle, DialogPanel, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";

interface Props {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

const MODELS = ["sonnet", "opus", "haiku"] as const;

export function CreateAgentDialog({ serverId, open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState<typeof MODELS[number]>("sonnet");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await api.createAgent({
        serverId, name, displayName,
        description: description || undefined,
        systemPrompt: systemPrompt || undefined,
        model,
      });
      onCreated?.(res.id);
      onOpenChange(false);
      setName(""); setDisplayName(""); setDescription(""); setSystemPrompt(""); setModel("sonnet");
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
            <DialogTitle>Create agent</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <DialogPanel>
              <div className="space-y-4">
                <Field>
                  <FieldLabel>Identifier</FieldLabel>
                  <Input value={name} required pattern="[a-z0-9_-]+" maxLength={64}
                    onChange={(e) => setName((e.target as HTMLInputElement).value.toLowerCase())}
                    placeholder="researcher" />
                </Field>
                <Field>
                  <FieldLabel>Display name</FieldLabel>
                  <Input value={displayName} required maxLength={120}
                    onChange={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                    placeholder="Research Agent" />
                </Field>
                <Field>
                  <FieldLabel>Description</FieldLabel>
                  <Input value={description}
                    onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
                    placeholder="What does this agent do?" />
                </Field>
                <Field>
                  <FieldLabel>System prompt</FieldLabel>
                  <Textarea value={systemPrompt} rows={6}
                    onChange={(e) => setSystemPrompt((e.target as HTMLTextAreaElement).value)}
                    placeholder="You are an expert in…" />
                </Field>
                <Field>
                  <FieldLabel>Model</FieldLabel>
                  <div className="flex gap-2">
                    {MODELS.map((m) => (
                      <button key={m} type="button" onClick={() => setModel(m)}
                        className={`rounded border px-3 py-1 text-sm ${model === m ? "border-foreground bg-accent" : "border-border"}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </Field>
                {error && <p className="text-sm text-destructive-foreground">{error}</p>}
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

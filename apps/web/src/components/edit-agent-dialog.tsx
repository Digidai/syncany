"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogPortal, DialogBackdrop, DialogPopup,
  DialogHeader, DialogTitle, DialogPanel, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { api, ApiError, type Agent } from "@/lib/api";

interface Props {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const MODELS = ["sonnet", "opus", "haiku"] as const;

export function EditAgentDialog({ agent, open, onOpenChange, onSaved }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState<typeof MODELS[number]>("sonnet");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (agent && open) {
      setDisplayName(agent.displayName);
      setDescription(agent.description ?? "");
      setSystemPrompt(agent.systemPrompt ?? "");
      setModel(agent.model);
      setError(null);
    }
  }, [agent, open]);

  if (!agent) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agent) return;
    setLoading(true); setError(null);
    try {
      await api.updateAgent(agent.id, {
        displayName,
        description: description || null,
        systemPrompt: systemPrompt || null,
        model,
      });
      onSaved?.();
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
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Edit {agent.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <DialogPanel>
              <div className="space-y-4">
                <Field>
                  <FieldLabel>Identifier</FieldLabel>
                  <Input value={agent.name} disabled
                    title="Identifier is immutable. Delete + recreate the agent if you need a different one." />
                </Field>
                <Field>
                  <FieldLabel>Display name</FieldLabel>
                  <Input value={displayName} required maxLength={120}
                    onChange={(e) => setDisplayName((e.target as HTMLInputElement).value)} />
                </Field>
                <Field>
                  <FieldLabel>Description</FieldLabel>
                  <Input value={description}
                    onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
                    placeholder="What does this agent do?" />
                </Field>
                <Field>
                  <FieldLabel>System prompt</FieldLabel>
                  <Textarea value={systemPrompt} rows={8}
                    onChange={(e) => setSystemPrompt((e.target as HTMLTextAreaElement).value)}
                    placeholder="You are an expert in…" />
                </Field>
                <Field>
                  <FieldLabel>Model</FieldLabel>
                  <div className="flex gap-2">
                    {MODELS.map((m) => (
                      <button key={m} type="button" onClick={() => setModel(m)}
                        className={`rounded border px-3 py-1 text-sm capitalize ${model === m ? "border-cyan-500 bg-cyan-500/10 text-cyan-700" : "border-border"}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </Field>
                <p className="text-xs text-muted-foreground">
                  Changes to system prompt take effect on the next message —
                  the bridge restarts the Claude Code process for this agent.
                </p>
                {error && <p className="text-sm text-destructive-foreground">{error}</p>}
              </div>
            </DialogPanel>
            <DialogFooter className="flex justify-end gap-2">
              <DialogClose render={<Button variant="outline" type="button">Cancel</Button>} />
              <Button type="submit" loading={loading}>Save</Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

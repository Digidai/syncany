"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogPortal, DialogBackdrop, DialogPopup,
  DialogHeader, DialogTitle, DialogPanel, DialogFooter, DialogClose,
} from "@raltic/ui/components/ui/dialog";
import { Button } from "@raltic/ui/components/ui/button";
import { Input } from "@raltic/ui/components/ui/input";
import { Textarea } from "@raltic/ui/components/ui/textarea";
import { Field, FieldLabel } from "@raltic/ui/components/ui/field";
import { api, ApiError, RUNTIME_LABEL, RUNTIME_MODELS, type Agent, type RuntimeId } from "@/lib/api";
import { GeneratedAvatar } from "./generated-avatar";
import { randomAvatarSeed } from "@/lib/avatar";
import { Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function EditAgentDialog({ agent, open, onOpenChange, onSaved }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [runtime, setRuntime] = useState<RuntimeId>("claude");
  const [model, setModel] = useState<string>("sonnet");
  const [avatarSeed, setAvatarSeed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (agent && open) {
      setDisplayName(agent.displayName);
      setDescription(agent.description ?? "");
      setSystemPrompt(agent.systemPrompt ?? "");
      // Legacy-runtime guard (backcompat H3): agent.runtime is plain
      // TEXT post-S2 and may be "gemini"/"copilot" from before the
      // removal. RUNTIME_MODELS[unknown] is undefined → .includes
      // would throw and crash the dialog. Fall back to "claude" so
      // the user can pick a real runtime, with a banner via setError.
      const effectiveRuntime: RuntimeId = (RUNTIME_MODELS as Record<string, readonly string[] | undefined>)[agent.runtime]
        ? (agent.runtime as RuntimeId)
        : "claude";
      setRuntime(effectiveRuntime);
      const allowed = RUNTIME_MODELS[effectiveRuntime];
      setModel(allowed.includes(agent.model) ? agent.model : allowed[0]);
      setAvatarSeed(agent.avatarSeed ?? null);
      setError(
        effectiveRuntime !== agent.runtime
          ? `This agent's previous runtime "${agent.runtime}" was removed. Pick a new runtime + model and save.`
          : null,
      );
    }
  }, [agent, open]);

  function pickRuntime(r: RuntimeId) {
    setRuntime(r);
    if (!RUNTIME_MODELS[r].includes(model)) setModel(RUNTIME_MODELS[r][0]);
  }

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
        runtime,
        model,
        avatarSeed,
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
                  <FieldLabel>Avatar</FieldLabel>
                  <div className="flex items-center gap-3">
                    <GeneratedAvatar id={agent.id} name={displayName || agent.displayName} seed={avatarSeed} size="xl" />
                    <div className="flex flex-col gap-1.5">
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => setAvatarSeed(randomAvatarSeed())}>
                        <Shuffle className="mr-1 h-3.5 w-3.5" /> Shuffle
                      </Button>
                      {avatarSeed && (
                        <button type="button"
                          onClick={() => setAvatarSeed(null)}
                          className="text-xs text-muted-foreground hover:text-foreground">
                          Reset to default
                        </button>
                      )}
                    </div>
                  </div>
                </Field>
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
                  <FieldLabel>Runtime</FieldLabel>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {(["claude", "codex", "openclaw", "hermes"] as RuntimeId[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => pickRuntime(r)}
                        className={cn(
                          "flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          runtime === r ? "border-cyan-500 bg-cyan-500/10" : "border-border hover:border-foreground/20",
                        )}
                      >
                        <div className="font-medium">{RUNTIME_LABEL[r]}</div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {RUNTIME_MODELS[r].join(" / ")}
                        </p>
                      </button>
                    ))}
                  </div>
                </Field>
                {runtime !== agent.runtime && (
                  <p className="rounded border border-amber-500/40 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    Switching runtime starts a fresh session — past context won&apos;t carry over. DM history is preserved.
                  </p>
                )}
                <Field>
                  <FieldLabel>Model</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {RUNTIME_MODELS[runtime].map((m) => (
                      <button key={m} type="button" onClick={() => setModel(m)}
                        className={cn(
                          "rounded border px-3 py-1 text-sm transition-colors",
                          model === m ? "border-cyan-500 bg-cyan-500/10 text-cyan-700" : "border-border",
                        )}>
                        {m}
                      </button>
                    ))}
                  </div>
                </Field>
                <p className="text-xs text-muted-foreground">
                  Changes to system prompt take effect on the next message —
                  the bridge restarts the agent process to apply them.
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

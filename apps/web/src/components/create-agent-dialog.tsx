"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogPortal, DialogBackdrop, DialogPopup,
  DialogHeader, DialogTitle, DialogPanel, DialogFooter, DialogClose,
} from "@raltic/ui/components/ui/dialog";
import { Button } from "@raltic/ui/components/ui/button";
import { Input } from "@raltic/ui/components/ui/input";
import { Textarea } from "@raltic/ui/components/ui/textarea";
import { Field, FieldLabel } from "@raltic/ui/components/ui/field";
import { api, ApiError, RUNTIME_LABEL, RUNTIME_MODELS, type RuntimeId, type MachineRuntimeRow } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

export function CreateAgentDialog({ serverId, open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [runtime, setRuntime] = useState<RuntimeId>("claude");
  const [model, setModel] = useState<string>(RUNTIME_MODELS.claude[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Detected runtime availability across all of the user's machine keys.
  // Drives the picker's per-option install/login hint.
  const [machines, setMachines] = useState<MachineRuntimeRow[] | null>(null);

  // Fetch runtime availability when dialog opens. Cached for the dialog
  // session — refetch on next open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Scope to THIS workspace — without `{ serverId }`, a bridge ready
    // in workspace B would make a runtime look ready in workspace A
    // even though machine keys are workspace-scoped at the bridge layer.
    api.listMachineKeys({ serverId }).then(({ keys }) => {
      if (cancelled) return;
      const all: MachineRuntimeRow[] = [];
      for (const k of keys) for (const m of k.machines) all.push(m);
      setMachines(all);
    }).catch(() => { /* swallow — picker just shows static hints */ });
    return () => { cancelled = true; };
  }, [open, serverId]);

  // Per-runtime availability summary: any machine has it detected + authed?
  // Tracks all 4 runtimes (claude/codex fully shipped, gemini/copilot
  // scaffolds — Runtimes panel uses this data to render install hints).
  const runtimeAvail = useMemo(() => {
    const avail: Record<RuntimeId, "ready" | "needs_login" | "not_installed" | "unknown"> = {
      claude: "unknown", codex: "unknown", gemini: "unknown", copilot: "unknown",
    };
    if (!machines) return avail;
    for (const id of ["claude", "codex", "gemini", "copilot"] as RuntimeId[]) {
      let best: "ready" | "needs_login" | "not_installed" = "not_installed";
      for (const m of machines) {
        const r = m.runtimes.find(x => x.id === id);
        if (!r) continue;
        if (r.detected && r.authed) { best = "ready"; break; }
        if (r.detected && best === "not_installed") best = "needs_login";
      }
      avail[id] = best;
    }
    return avail;
  }, [machines]);

  function pickRuntime(r: RuntimeId) {
    setRuntime(r);
    if (!RUNTIME_MODELS[r].includes(model)) setModel(RUNTIME_MODELS[r][0]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await api.createAgent({
        serverId, name, displayName,
        description: description || undefined,
        systemPrompt: systemPrompt || undefined,
        runtime,
        model,
      });
      onCreated?.(res.id);
      onOpenChange(false);
      setName(""); setDisplayName(""); setDescription(""); setSystemPrompt("");
      setRuntime("claude"); setModel(RUNTIME_MODELS.claude[0]);
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
                  <FieldLabel>Runtime</FieldLabel>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {(["claude", "codex"] as RuntimeId[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => pickRuntime(r)}
                        className={cn(
                          "flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          runtime === r
                            ? "border-cyan-500 bg-cyan-500/10"
                            : "border-border hover:border-foreground/20",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{RUNTIME_LABEL[r]}</span>
                          <RuntimeAvailabilityChip state={runtimeAvail[r]} />
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {r === "claude" ? "Anthropic — opus / sonnet / haiku" : "OpenAI — gpt-5.5 / gpt-5.4 / gpt-5.3-codex-spark"}
                        </p>
                        {runtimeAvail[r] === "not_installed" && (
                          <p className="mt-1 text-[11px] text-amber-700">
                            Not installed on any of your bridges. Run on your laptop:
                            <code className="ml-1 rounded bg-muted px-1">
                              {r === "claude" ? "npm i -g @anthropic-ai/claude-code" : "npm i -g @openai/codex && codex login"}
                            </code>
                          </p>
                        )}
                        {runtimeAvail[r] === "needs_login" && (
                          <p className="mt-1 text-[11px] text-amber-700">
                            Installed but not signed in. Run: <code className="rounded bg-muted px-1">{r} login</code>
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </Field>

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

function RuntimeAvailabilityChip({ state }: { state: "ready" | "needs_login" | "not_installed" | "unknown" }) {
  if (state === "ready") {
    return <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">ready</span>;
  }
  if (state === "needs_login") {
    return <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">sign-in</span>;
  }
  if (state === "not_installed") {
    return <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">not installed</span>;
  }
  return null;
}

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
  // P1 W7: top-level runtime-mode choice. 'raltic' = cloud-native
  // (default, zero local install); 'bridge' = legacy local daemon path.
  // The runtime+model picker beneath only matters when mode === 'bridge'
  // (each CLI has its own model namespace). In cloud mode we use
  // the platform's managed router and the user picks model separately
  // in a single dropdown.
  const [runtimeMode, setRuntimeMode] = useState<"raltic" | "bridge">("raltic");
  const [runtime, setRuntime] = useState<RuntimeId>("claude");
  // Cloud (raltic) router supports a different model namespace than any
  // individual bridge CLI. When the user toggles modes we MUST reset
  // model to a valid option for the target mode — otherwise a cloud-only
  // model name leaks into a bridge submission and the API rejects it on
  // RUNTIME_MODELS validation (codex MED).
  const CLOUD_MODELS = [
    "claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-7",
    "gpt-5.4", "gpt-5.5",
    "gemini-2.5-flash", "gemini-2.5-pro",
  ];
  const [model, setModel] = useState<string>(CLOUD_MODELS[0]);

  function pickRuntimeMode(next: "raltic" | "bridge") {
    setRuntimeMode(next);
    // Normalize model to the new mode's namespace.
    if (next === "raltic") {
      if (!CLOUD_MODELS.includes(model)) setModel(CLOUD_MODELS[0]);
    } else {
      if (!RUNTIME_MODELS[runtime].includes(model)) setModel(RUNTIME_MODELS[runtime][0]);
    }
  }
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
        runtimeMode,
        model,
      });
      onCreated?.(res.id);
      onOpenChange(false);
      setName(""); setDisplayName(""); setDescription(""); setSystemPrompt("");
      // Codex HIGH (round 3): reset model to the CLOUD default because we
      // reset runtimeMode to "raltic" — otherwise the NEXT create-agent
      // submission would carry a bridge-only model name (e.g. "sonnet")
      // into cloud mode and the API would reject it on RUNTIME_MODELS
      // validation.
      setRuntimeMode("raltic"); setRuntime("claude"); setModel(CLOUD_MODELS[0]);
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
                {/* Top-level: where does the agent live? Defaults to
                    "Cloud (Raltic)" — zero-install, lazy sandbox container.
                    "My machine (Bridge)" keeps the original spawn-into-
                    local-daemon flow for users who care about privacy /
                    using their own API quota. */}
                <Field>
                  <FieldLabel>Where does this agent live?</FieldLabel>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => pickRuntimeMode("raltic")}
                      aria-pressed={runtimeMode === "raltic"}
                      className={cn(
                        "flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        runtimeMode === "raltic"
                          ? "border-cyan-500 bg-cyan-500/10"
                          : "border-border hover:border-foreground/20",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Cloud (Raltic)</span>
                        <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700">recommended</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Zero install. Runs in our cloud sandbox — files, bash, git all work. Mobile-friendly.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => pickRuntimeMode("bridge")}
                      aria-pressed={runtimeMode === "bridge"}
                      className={cn(
                        "flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        runtimeMode === "bridge"
                          ? "border-cyan-500 bg-cyan-500/10"
                          : "border-border hover:border-foreground/20",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">My machine (Bridge)</span>
                        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">advanced</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Spawns on your local bridge. Use your own API key + repo on disk.
                      </p>
                    </button>
                  </div>
                </Field>

                {runtimeMode === "bridge" && (
                <Field>
                  <FieldLabel>Runtime</FieldLabel>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {(["claude", "codex"] as RuntimeId[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => pickRuntime(r)}
                        aria-pressed={runtime === r}
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
                )}

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
                  <FieldLabel>
                    Model
                    {runtimeMode === "raltic" && (
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                        — routed via easyrouter (Claude / GPT / Gemini)
                      </span>
                    )}
                  </FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {/* Cloud mode: any modern model from any provider, since
                        easyrouter handles routing. Bridge mode: only the
                        models the selected runtime's CLI knows about. */}
                    {(runtimeMode === "raltic" ? CLOUD_MODELS : RUNTIME_MODELS[runtime]).map((m) => (
                      <button key={m} type="button" onClick={() => setModel(m)}
                        aria-pressed={model === m}
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

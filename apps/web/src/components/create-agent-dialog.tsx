"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogPortal, DialogBackdrop, DialogPopup,
  DialogHeader, DialogTitle, DialogPanel, DialogFooter, DialogClose,
} from "@/components/heroui-pro/dialog";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Textarea } from "@/components/heroui-pro/textarea";
import { Field, FieldLabel } from "@/components/heroui-pro/field";
import { api, ApiError, CLOUD_MODELS, RUNTIME_LABEL, RUNTIME_MODELS, type RuntimeId, type MachineRuntimeRow } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

/** One-line description per bridge runtime — shown under each option
 *  in the picker. Keep punchy (1 line); long copy goes in the install
 *  hint below the chip. */
const RUNTIME_SHORT_DESC: Record<RuntimeId, string> = {
  claude:   "Anthropic — opus / sonnet / haiku",
  codex:    "OpenAI — gpt-5.5 / gpt-5.4 / gpt-5.3-codex-spark",
  openclaw: "Local-first multi-channel daemon (you install + run)",
  hermes:   "Self-improving agent with persistent memory (you install + run)",
};

/** Install command per runtime — shown when the bridge reports the
 *  CLI isn't detected on any of the user's machines. external_daemon
 *  runtimes (openclaw, hermes) include both install + onboard steps. */
const RUNTIME_INSTALL_CMD: Record<RuntimeId, string> = {
  claude:   "npm i -g @anthropic-ai/claude-code",
  codex:    "npm i -g @openai/codex && codex login",
  openclaw: "npm i -g openclaw && openclaw onboard --install-daemon",
  hermes:   "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
};

const optionButtonClass =
  "!h-auto !w-full min-w-0 !items-stretch !justify-start !whitespace-normal rounded-xl px-3 py-2 text-left text-sm text-foreground transition-colors";

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
  const [model, setModel] = useState<string>(CLOUD_MODELS[0]);

  function pickRuntimeMode(next: "raltic" | "bridge") {
    setRuntimeMode(next);
    // Normalize model to the new mode's namespace.
    if (next === "raltic") {
      if (!(CLOUD_MODELS as readonly string[]).includes(model)) setModel(CLOUD_MODELS[0]);
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
  // Tracks all 4 shipped runtimes: claude/codex (per_turn_spawn) and
  // openclaw/hermes (external_daemon — user must onboard the daemon
  // before bridge can talk to them).
  const runtimeAvail = useMemo(() => {
    const avail: Record<RuntimeId, "ready" | "needs_login" | "not_installed" | "unknown"> = {
      claude: "unknown", codex: "unknown", openclaw: "unknown", hermes: "unknown",
    };
    if (!machines) return avail;
    for (const id of ["claude", "codex", "openclaw", "hermes"] as RuntimeId[]) {
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
        <DialogPopup className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create agent</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <DialogPanel>
              <div className="space-y-4">
                {/* Top-level: where does the agent live? Defaults to
                    "Cloud (Raltic)" — zero-install, lazy sandbox container.
                    "My machine (Bridge)" keeps the original spawn-into-
                    local-daemon flow for users who care about privacy /
                    using their own API quota. */}
                <Field>
                  <FieldLabel id="create-agent-mode-label">Where does this agent live?</FieldLabel>
                  <div role="group" aria-labelledby="create-agent-mode-label" className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      onClick={() => pickRuntimeMode("raltic")}
                      aria-pressed={runtimeMode === "raltic"}
                      variant="outline"
                      className={cn(
                        optionButtonClass,
                        "flex-1 flex-col",
                        runtimeMode === "raltic"
                          ? "border-cyan-500 bg-cyan-500/10"
                          : "border-border hover:border-foreground/20",
                      )}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 font-medium">Cloud (Raltic)</span>
                        <span className="shrink-0 rounded-full bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700 dark:text-cyan-300">recommended</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Zero install. Runs in our cloud sandbox — files, bash, git all work. Mobile-friendly.
                      </p>
                    </Button>
                    <Button
                      type="button"
                      onClick={() => pickRuntimeMode("bridge")}
                      aria-pressed={runtimeMode === "bridge"}
                      variant="outline"
                      className={cn(
                        optionButtonClass,
                        "flex-1 flex-col",
                        runtimeMode === "bridge"
                          ? "border-cyan-500 bg-cyan-500/10"
                          : "border-border hover:border-foreground/20",
                      )}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 font-medium">My machine (Bridge)</span>
                        <span className="shrink-0 rounded-full bg-[var(--default)] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">advanced</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Spawns on your local bridge. Use your own API key + repo on disk.
                      </p>
                    </Button>
                  </div>
                </Field>

                {runtimeMode === "bridge" && (
                <Field>
                  <FieldLabel id="create-agent-runtime-label">Runtime</FieldLabel>
                  <div role="group" aria-labelledby="create-agent-runtime-label" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(["claude", "codex", "openclaw", "hermes"] as RuntimeId[]).map((r) => (
                      <Button
                        key={r}
                        type="button"
                        onClick={() => pickRuntime(r)}
                        aria-pressed={runtime === r}
                        variant="outline"
                        className={cn(
                          optionButtonClass,
                          "flex-col",
                          runtime === r
                            ? "border-cyan-500 bg-cyan-500/10"
                            : "border-border hover:border-foreground/20",
                        )}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 font-medium">{RUNTIME_LABEL[r]}</span>
                          <RuntimeAvailabilityChip state={runtimeAvail[r]} />
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {RUNTIME_SHORT_DESC[r]}
                        </p>
                        {runtimeAvail[r] === "not_installed" && (
                          <p className="mt-1 text-[11px] text-amber-700">
                            Not installed on any of your bridges. Run on your laptop:
                            <code className="ml-1 break-all rounded bg-muted px-1">
                              {RUNTIME_INSTALL_CMD[r]}
                            </code>
                          </p>
                        )}
                        {runtimeAvail[r] === "needs_login" && (
                          <p className="mt-1 text-[11px] text-amber-700">
                            {/* external_daemon runtimes (openclaw, hermes)
                                aren't a `login` command — they're a daemon
                                that's not running. */}
                            {r === "openclaw" || r === "hermes"
                              ? `Installed but daemon not running. Start: ${r === "openclaw" ? "openclaw onboard --install-daemon" : "hermes start"}`
                              : <>Installed but not signed in. Run: <code className="rounded bg-muted px-1">{r} login</code></>}
                          </p>
                        )}
                      </Button>
                    ))}
                  </div>
                </Field>
                )}

                <Field>
                  <FieldLabel htmlFor="create-agent-identifier">Identifier</FieldLabel>
                  <Input id="create-agent-identifier" value={name} required pattern="[a-z0-9_-]+" maxLength={64}
                    onChange={(e) => setName((e.target as HTMLInputElement).value.toLowerCase())}
                    placeholder="researcher" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="create-agent-display-name">Display name</FieldLabel>
                  <Input id="create-agent-display-name" value={displayName} required maxLength={120}
                    onChange={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                    placeholder="Research Agent" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="create-agent-description">Description</FieldLabel>
                  <Input id="create-agent-description" value={description}
                    onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
                    placeholder="What does this agent do?" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="create-agent-system-prompt">System prompt</FieldLabel>
                  <Textarea id="create-agent-system-prompt" value={systemPrompt} rows={6}
                    onChange={(e) => setSystemPrompt((e.target as HTMLTextAreaElement).value)}
                    placeholder="You are an expert in…" />
                </Field>
                <Field>
                  <FieldLabel id="create-agent-model-label">
                    Model
                    {runtimeMode === "raltic" && (
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                        — routed via easyrouter (Claude / GPT / Gemini)
                      </span>
                    )}
                  </FieldLabel>
                  <div role="group" aria-labelledby="create-agent-model-label" className="flex flex-wrap gap-2">
                    {/* Cloud mode: any modern model from any provider, since
                        easyrouter handles routing. Bridge mode: only the
                        models the selected runtime's CLI knows about. */}
                    {(runtimeMode === "raltic" ? CLOUD_MODELS : RUNTIME_MODELS[runtime]).map((m) => (
                      <Button key={m} type="button" onClick={() => setModel(m)}
                        aria-pressed={model === m}
                        variant="outline"
                        size="sm"
                        className={cn(
                          "!h-auto !whitespace-normal break-all text-sm transition-colors",
                          model === m ? "border-cyan-500 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" : "border-border",
                        )}>
                        {m}
                      </Button>
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
    return <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">ready</span>;
  }
  if (state === "needs_login") {
    return <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">sign-in</span>;
  }
  if (state === "not_installed") {
    return <span className="rounded-full bg-[var(--default)] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">not installed</span>;
  }
  return null;
}

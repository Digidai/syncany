"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, RUNTIME_LABEL, type RuntimeId } from "@/lib/api";
import { Button } from "@raltic/ui/components/ui/button";
import { Input } from "@raltic/ui/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@raltic/ui/components/ui/card";
import { CheckCircle2, Circle, Copy, KeyRound, Terminal, MessageSquare, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  // CONTRACT: serverId/serverSlug identify the workspace the wizard
  // operates on. They MUST be the user's PERSONAL (owned) workspace
  // — NOT the currently-viewed workspace (which may be one the user is
  // merely invited to). Mixing those up is the root cause of the
  // "Olivia" production bug: an invitee ran the wizard on the inviter's
  // workspace, minted a machine_key bound to the inviter's serverId,
  // and her own workspace's agent stayed offline forever.
  //
  // Callers MUST resolve `me.personalServerId/Slug` first (see
  // /api/v1/me); never read from useParams() / current URL slug.
  serverId: string;
  serverSlug: string;
  /** True if the user already has a connected bridge for THIS workspace
   *  — wizard is being re-opened (e.g. from settings) to set up an
   *  additional laptop. Drives a copy change so we don't pretend the
   *  user is brand-new. */
  hasExistingBridge?: boolean;
  /** Tone + framing of the wizard. "solo" is the brand-new-user path
   *  (default). "invite" reframes step 1 to acknowledge the user just
   *  joined someone else's workspace and explain WHY they still need
   *  to set up bridge in their OWN workspace (because the inviter's
   *  bridge handles only their inviter's agents). */
  flavor?: "solo" | "invite";
  /** Inviter workspace display name — only used when flavor === "invite"
   *  for the step-1 copy. */
  inviterWorkspaceName?: string;
  /** Called when user clicks "I'll do this later" or finishes step 4. */
  onDismiss?: () => void;
}

/** Hard cap on bridge-connect polling — past this, surface a help panel
 *  instead of spinning forever. 4 minutes covers a slow `npm install` on
 *  a cold cache and the first `claude` auth dance. */
const BRIDGE_POLL_TIMEOUT_MS = 4 * 60_000;
const BRIDGE_POLL_INTERVAL_MS = 3_000;

/** sessionStorage key for resuming an in-progress wizard after a page
 *  refresh. We store ONLY the issued key's id (not its plaintext) — the
 *  user already copied the plaintext into their terminal; on resume we
 *  poll for connection without needing to re-show the secret. */
const RESUME_KEY_PREFIX = "raltic:wizard:resume:";

interface ResumeState {
  issuedKeyId: string;
  /** Display name shown in the resume notice — cosmetic only. */
  keyName?: string;
  /** When the previous wizard ran — drop entries older than 24h. */
  at: number;
}
const RESUME_TTL_MS = 24 * 60 * 60 * 1000;

function readResume(serverId: string): ResumeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RESUME_KEY_PREFIX + serverId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumeState;
    if (!parsed?.issuedKeyId || Date.now() - parsed.at > RESUME_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}
function writeResume(serverId: string, state: ResumeState): void {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(RESUME_KEY_PREFIX + serverId, JSON.stringify(state)); }
  catch { /* private mode — degrade gracefully */ }
}
function clearResume(serverId: string): void {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(RESUME_KEY_PREFIX + serverId); }
  catch { /* ignore */ }
}

const API_URL = process.env.NEXT_PUBLIC_RALTIC_API_URL ?? "https://api.raltic.com";

/**
 * 4-step wizard shown to users who haven't connected a bridge yet:
 *   1. Welcome — what Raltic is, what to expect
 *   2. Create a machine API key (one-shot reveal)
 *   3. Run the bridge command on the user's laptop (with poll for connection)
 *   4. Send first message in the onboarding channel
 */
export function SetupWizard({
  serverId, serverSlug, hasExistingBridge = false,
  flavor = "solo", inviterWorkspaceName, onDismiss,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [keyName, setKeyName] = useState("My Mac");
  // Runtime choice made on step 1 — applied to the personal workspace's
  // Onboarding Assistant agent when the wizard completes (step 4). If
  // the user picks Codex, we PATCH the existing onboarding agent to
  // runtime=codex + model=gpt-5.5. Default stays Claude/Sonnet so users
  // who don't care (or don't have Codex installed) end up on the
  // best-supported path.
  const [runtime, setRuntime] = useState<"claude" | "codex" | "openclaw" | "hermes">("claude");
  // Tab selection on step 3 — quick npx (default + recommended), a
  // persistent install for users who want bridge to keep running after
  // they close the terminal, and a desktop-app link (placeholder until
  // the binary is published).
  const [installTab, setInstallTab] = useState<"quick" | "persistent" | "desktop">("quick");
  const [issued, setIssued] = useState<string | null>(null);
  /** Track the issued key's id so "start over" can revoke it before
   *  issuing a new one — otherwise abandoned keys pile up forever. */
  const [issuedKeyId, setIssuedKeyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  // Per-machine snapshots captured from the bridge's `/connect`.
  // Populated when step 4 fires; refreshed by the step-4 background poll
  // so `codex login` mid-wizard becomes visible within 3s.
  const [detectedMachines, setDetectedMachines] = useState<import("@/lib/api").MachineRuntimeRow[]>([]);
  /** Wall-clock floor for "what counts as a NEW reply". Set when wizard
   *  mounts so we don't accept a pre-existing agent reply that landed
   *  before the user even opened the wizard (edge case: user DM'd before
   *  triggering the wizard via ?wizard=1). */
  const wizardOpenedAtRef = useRef<number>(Date.now());
  /** Indicates the wizard auto-resumed after a page refresh — show a
   *  short banner so the user understands why they jumped past Step 1/2. */
  const [resumed, setResumed] = useState(false);

  // ── Resume after refresh: if sessionStorage carries an in-progress
  // key id from this server, validate it server-side BEFORE jumping into
  // step 3. We need to handle:
  //   - key revoked externally → clear resume, don't auto-resume
  //   - key already used (bridge connected before refresh) → step 4 directly
  //   - key freshly issued, never used → step 3 with poll
  // Without the validation, a stale resume entry from a week ago whose
  // key was used long ago would false-positive into step 4 instantly.
  useEffect(() => {
    // When the user is explicitly setting up an additional laptop (has
    // a working bridge already + landed via ?wizard=1), ignore any
    // stale resume entry from an abandoned earlier attempt — they want
    // a fresh key flow, not to continue someone else's progress.
    if (hasExistingBridge) {
      clearResume(serverId);
      return;
    }
    const r = readResume(serverId);
    if (!r) return;
    let cancelled = false;
    (async () => {
      try {
        const { keys } = await api.listMachineKeys({ serverId });
        if (cancelled) return;
        const k = keys.find(x => x.id === r.issuedKeyId);
        if (!k || k.revokedAt) {
          // Key gone or revoked — abandon the resume entry, let user
          // start fresh from step 1.
          clearResume(serverId);
          return;
        }
        setIssuedKeyId(r.issuedKeyId);
        setKeyName(r.keyName ?? "My Mac");
        if (k.lastUsedAt) {
          // Already connected. Skip the poll, mark complete.
          setBridgeOnline(true);
          setStep(4);
          clearResume(serverId);
          return;
        }
        // Just-issued, never used. Mark issued so the poll fires; the
        // Step-3 UI shows a "resumed" notice instead of the command panel
        // (we don't have the plaintext to re-display).
        // No plaintext to restore — `issued` stays null. The Step-3 UI
        // checks `resumed` to swap the command-panel for the resume notice.
        setResumed(true);
        setStep(3);
      } catch {
        // Network failure — leave resume entry alone, user can retry.
      }
    })();
    return () => { cancelled = true; };
  }, [serverId, hasExistingBridge]);
  // Step-3 polling state — `pollStartedAtRef` is a ref (not state) so
  // setting it doesn't tear down + recreate the interval. Reviews #1/#2
  // both flagged the original useState version as eating the first poll
  // cycle on its own re-render.
  const pollStartedAtRef = useRef<number | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  // Default-OPEN troubleshooting block on step 3. Used to hide behind a
  // "Having trouble?" toggle that 95% of confused users never clicked;
  // surfacing the Node ≥ 20 / Claude CLI checks unconditionally cuts
  // the "why isn't this working" support load.
  const [showHelp, setShowHelp] = useState(true);
  // Step-4 detection — find the user-created onboarding DM channel +
  // poll for the first agent reply (proof end-to-end works).
  const [onboardingDmId, setOnboardingDmId] = useState<string | null>(null);
  const [firstReplySeen, setFirstReplySeen] = useState(false);
  const lastChannelMaxSeqRef = useRef<number>(0);

  // ── Step 3: poll for THIS specific key's bridge to connect. We check
  // `machineKeys.lastUsedAt` for the just-issued key id — NOT the
  // user-level `hasConnectedBridge` flag, which would short-circuit a
  // "set up another laptop" flow because some other key is already
  // connected. Soft-cap at the timeout so we can surface help.
  useEffect(() => {
    // Either we just issued (have plaintext) OR we resumed (have id only).
    // Both cases are valid reasons to poll for the key's lastUsedAt.
    if (!(issued || resumed) || !issuedKeyId || bridgeOnline || step !== 3) return;
    if (pollStartedAtRef.current === null) pollStartedAtRef.current = Date.now();
    const startedAt = pollStartedAtRef.current;
    const t = setInterval(async () => {
      try {
        const { keys } = await api.listMachineKeys({ serverId });
        const me = keys.find(k => k.id === issuedKeyId);
        if (!me) {
          // Key disappeared (deleted / different account). Bail with an
          // explicit error rather than spinning forever.
          clearInterval(t);
          setError("Your machine key was removed. Start over to issue a new one.");
          return;
        }
        if (me.revokedAt) {
          clearInterval(t);
          setError("Your machine key was revoked. Start over to issue a new one.");
          return;
        }
        if (me.lastUsedAt) {
          setBridgeOnline(true);
          // Capture the latest detected machines for this key — wizard
          // step 4 renders a runtime strip from this. Polled every 3s
          // so a `codex login` in user's terminal shows up promptly.
          setDetectedMachines(me.machines ?? []);
          clearResume(serverId);   // bridge connected — no need to resume
          clearInterval(t);
          // Apply the runtime the user picked on step 1 to the personal
          // workspace's Onboarding Assistant agent so step 4's "send a
          // message" round-trip actually exercises that runtime. The
          // onboarding agent was created during runOnboarding (always
          // runtime=claude/sonnet); we lazy-flip it here when the user
          // picked something else. Best-effort — a flip failure shouldn't
          // block the wizard from advancing; user can edit the agent
          // manually from Settings → Agents.
          //
          // Codex review MED: previously this only fired for codex,
          // which silently routed openclaw/hermes wizard users through
          // a Claude agent and produced confusing round-trip behaviour.
          if (runtime !== "claude" && !hasExistingBridge) {
            void (async () => {
              try {
                const { agents: all } = await api.listAgents();
                const onboarding = all.find(
                  (a) => a.serverId === serverId && a.name === "onboarding",
                );
                if (onboarding && onboarding.runtime !== runtime) {
                  // Canonical default model per runtime — keep in sync
                  // with RUNTIME_MODELS[runtime][1] (slot 0 is "auto",
                  // which is a router-level alias not a real model).
                  const defaultModel: Record<RuntimeId, string> = {
                    claude:   "claude-sonnet-4-6",
                    codex:    "gpt-5.5",
                    openclaw: "claude-sonnet-4-6",
                    hermes:   "auto",
                  };
                  await api.updateAgent(onboarding.id, {
                    runtime,
                    model: defaultModel[runtime],
                  });
                }
              } catch (e) {
                console.warn("[wizard] couldn't flip onboarding agent runtime", e);
              }
            })();
          }
          setStep(4);
          return;
        }
        if (Date.now() - startedAt > BRIDGE_POLL_TIMEOUT_MS) {
          setPollTimedOut(true);
          // keep polling — bridge might come up after the user fixes the
          // env. We just stop hiding the help panel.
        }
      } catch { /* network blips are transient */ }
    }, BRIDGE_POLL_INTERVAL_MS);
    return () => clearInterval(t);
    // runtime + hasExistingBridge are read inside the bridge-online
    // branch when flipping the onboarding agent; including them as
    // deps keeps the effect honest if the user happens to change
    // runtime mid-poll (currently impossible from the UI, but the
    // lint contract still applies).
  }, [issued, resumed, issuedKeyId, bridgeOnline, step, serverId, runtime, hasExistingBridge]);

  // ── Discover the seeded Onboarding DM channel id so step 4 can both
  // (a) deep-link the "Open the conversation" button and (b) actively
  // verify a real agent reply landed.
  useEffect(() => {
    if (step < 3) return;
    if (onboardingDmId) return;
    let cancelled = false;
    api.getServerBySlug(serverSlug).then((data) => {
      if (cancelled) return;
      // Onboarding-Assistant DM is the dm-type channel seeded with the
      // canonical name "onboarding-assistant" by runOnboarding().
      const dm = data.channels.find(c => c.type === "dm" && c.name === "onboarding-assistant");
      if (dm) {
        setOnboardingDmId(dm.id);
        lastChannelMaxSeqRef.current = dm.maxSeq ?? 0;
      }
    }).catch(() => { /* ignore — wizard still works with a generic CTA */ });
    return () => { cancelled = true; };
  }, [step, serverSlug, onboardingDmId]);

  // ── Step 4 detection: poll the onboarding DM for an agent reply that
  // is BOTH past our seq baseline AND created after the wizard opened.
  // The double check rules out "stale" agent replies that happened before
  // the user re-opened the wizard via ?wizard=1 — a real fresh reply has
  // to come after this session started.
  useEffect(() => {
    if (step !== 4 || firstReplySeen || !onboardingDmId) return;
    const t = setInterval(async () => {
      try {
        const data = await api.listMessages(onboardingDmId, { limit: 5 });
        const newAgentMsg = data.messages.find(
          m => m.senderType === "agent"
            && m.seq > lastChannelMaxSeqRef.current
            && new Date(m.createdAt).getTime() >= wizardOpenedAtRef.current,
        );
        if (newAgentMsg) {
          setFirstReplySeen(true);
          clearInterval(t);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(t);
  }, [step, firstReplySeen, onboardingDmId]);

  // ── Step 4 runtime refresh — re-pull this key's per-machine snapshots
  // every 3s so a `codex login` in user's terminal becomes visible
  // promptly. Stops when wizard closes (cleanup on step !== 4).
  useEffect(() => {
    if (step !== 4 || !issuedKeyId) return;
    const t = setInterval(async () => {
      try {
        const { keys } = await api.listMachineKeys({ serverId });
        const me = keys.find(k => k.id === issuedKeyId);
        // Only overwrite when we actually got machines back. Empty `[]`
        // from a transient API hiccup would otherwise stomp the rendered
        // strip and cause a flicker to "no runtimes detected".
        if (me?.machines && me.machines.length > 0) {
          setDetectedMachines(me.machines);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(t);
  }, [step, issuedKeyId, serverId]);

  async function createKey() {
    setCreating(true); setError(null);
    try {
      const res = await api.createMachineKey({ serverId, name: keyName.trim() || "My Mac" });
      setIssued(res.apiKey);
      setIssuedKeyId(res.id);
      setResumed(false);
      writeResume(serverId, { issuedKeyId: res.id, keyName: res.name, at: Date.now() });
      setStep(3);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally { setCreating(false); }
  }

  /** "Start over" path — revoke the abandoned key first so retried users
   *  don't accumulate a graveyard of valid-but-unused machine keys (each
   *  one is a full bridge credential). Best-effort: if revoke fails we
   *  still let them retry; orphaned keys can be cleaned up from settings. */
  async function startOverFromStep2() {
    if (issuedKeyId) {
      try { await api.revokeMachineKey(issuedKeyId); }
      catch (e) {
        // Don't block retry — but a failed revoke means the abandoned
        // key is still valid. Log loudly so a real failure isn't silent.
        console.warn("[wizard] revoke of abandoned key failed — it's still valid", { id: issuedKeyId, error: e });
      }
    }
    clearResume(serverId);
    setIssued(null);
    setIssuedKeyId(null);
    setResumed(false);
    pollStartedAtRef.current = null;
    setPollTimedOut(false);
    setShowHelp(false);
    setBridgeOnline(false);     // safety: never short-circuit retry
    setError(null);             // clear stale red toast from prior attempt
    setStep(2);
  }

  /** Strip `?wizard=1` so dismissing once-and-for-all doesn't keep
   *  re-prompting the user every time they return to the workspace home. */
  function handleDismiss() {
    if (typeof window !== "undefined" && window.location.search.includes("wizard=1")) {
      router.replace(`/s/${serverSlug}`);
    }
    onDismiss?.();
  }

  // Wizard uses the CLI's `setup` form so the key is persisted to
  // ~/.raltic/config.json and the bridge starts in the same command.
  // `--server-url` is omitted when it equals the prod default so the
  // copy-pastable line stays one screen wide for 95% of users; staging /
  // self-hosted setups still get the flag appended.
  const SERVER_URL_DEFAULT = "https://api.raltic.com";
  const quickCmd = issued
    ? API_URL === SERVER_URL_DEFAULT
      ? `npx -y @raltic/bridge setup ${issued}`
      : `npx -y @raltic/bridge setup ${issued} --server-url ${API_URL}`
    : "";
  const persistentInstall = `npm install -g @raltic/bridge@latest`;
  const persistentRun = issued
    ? API_URL === SERVER_URL_DEFAULT
      ? `raltic-bridge setup ${issued}`
      : `raltic-bridge setup ${issued} --server-url ${API_URL}`
    : "";
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-xl mx-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                {hasExistingBridge
                  ? "Connect another laptop"
                  : flavor === "invite"
                  ? "Bring YOUR agents online"
                  : "Set up your laptop"}
              </CardTitle>
              <button onClick={handleDismiss}
                className="text-xs text-muted-foreground hover:text-foreground">
                I'll do this later →
              </button>
            </div>
            <CardDescription>
              {flavor === "invite" ? (
                <>
                  You joined{" "}
                  <strong>{inviterWorkspaceName ?? "another workspace"}</strong>{" "}
                  — their agents are already online (their bridge handles those).
                  To create agents <em>of your own</em>, we connect your laptop here.
                </>
              ) : (
                <>
                  Each AI teammate runs on <em>your own</em> laptop and joins channels
                  here in real time. We&apos;ll connect your laptop in 2 minutes.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardPanel>
            <ol className="space-y-3 text-sm">
              <Step n={1} active={step === 1} done={step > 1} title="Welcome" />
              <Step n={2} active={step === 2} done={step > 2}
                title="Create a machine API key" />
              <Step n={3} active={step === 3} done={step > 3}
                title={bridgeOnline ? "Bridge connected ✓" : "Run the bridge on your laptop"} />
              <Step n={4} active={step === 4 && !firstReplySeen} done={firstReplySeen}
                title={firstReplySeen ? "First reply received ✓" : "Send your first message"} />
            </ol>

            <div className="mt-6 rounded border bg-muted/30 p-4">
              {step === 1 && (
                <div className="space-y-4 text-sm">
                  {hasExistingBridge && (
                    <div className="rounded border border-cyan-500/40 bg-cyan-50 p-3 text-xs dark:bg-cyan-950/20">
                      <p className="font-medium text-cyan-700 dark:text-cyan-400">
                        You already have a bridge connected.
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        This will issue a NEW machine key for an additional laptop. Your existing
                        key + bridge keep working — agents are leader-elected so you won&apos;t double-reply.
                      </p>
                    </div>
                  )}

                  {/* Runtime selector — captures the user's choice upfront
                      so step 3's "do you have the right CLI installed?"
                      hint can be runtime-specific, and step 4's wrap-up
                      can PATCH the onboarding agent to the chosen runtime
                      via api.updateAgent. Defaults to Claude (best-tested
                      path); the toggle isn't shown when the user is
                      adding a SECOND laptop (their agents already have a
                      runtime set). */}
                  {!hasExistingBridge && (
                    <div>
                      <p className="font-medium">Which AI runtime do you want to use?</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        All run locally on YOUR laptop. You can change per-agent later.
                      </p>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <RuntimePick
                          id="claude"
                          checked={runtime === "claude"}
                          onChange={() => setRuntime("claude")}
                          title="Claude Code"
                          chip="Recommended"
                          chipTone="cyan"
                          body="Anthropic Claude — Sonnet 4.6 default, also Opus/Haiku. Requires the claude CLI."
                          installHref="https://docs.claude.com/en/docs/claude-code/setup"
                        />
                        <RuntimePick
                          id="codex"
                          checked={runtime === "codex"}
                          onChange={() => setRuntime("codex")}
                          title="OpenAI Codex"
                          chip="Preview"
                          chipTone="amber"
                          body="OpenAI Codex — GPT-5.5 default. Requires the codex CLI logged in."
                          installHref="https://platform.openai.com/docs/codex/cli"
                        />
                        {/* External-daemon runtimes — the user runs the
                            daemon themselves and Raltic just shells out
                            to its CLI. Marked "Advanced" because they
                            require a separate onboarding (multi-channel
                            routing for OpenClaw, skill marketplace for
                            Hermes) most new Raltic users don't need yet. */}
                        <RuntimePick
                          id="openclaw"
                          checked={runtime === "openclaw"}
                          onChange={() => setRuntime("openclaw")}
                          title="OpenClaw"
                          chip="Advanced"
                          chipTone="violet"
                          body="Local-first multi-channel assistant. Install separately; Raltic detects your daemon."
                          installHref="https://github.com/openclaw/openclaw"
                        />
                        <RuntimePick
                          id="hermes"
                          checked={runtime === "hermes"}
                          onChange={() => setRuntime("hermes")}
                          title="Hermes Agent"
                          chip="Advanced"
                          chipTone="rose"
                          body="Nous Research's self-improving agent with persistent memory + auto skills. Install separately."
                          installHref="https://hermes-agent.nousresearch.com/"
                        />
                      </div>
                    </div>
                  )}

                  <div className="rounded border bg-card p-3 text-xs">
                    <p className="font-medium">You&apos;ll need on this laptop:</p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      <li>• <strong>Node ≥ 20</strong> — check with <code className="rounded bg-muted px-1">node -v</code></li>
                      {runtime === "claude" && (
                        <li>
                          • The <a className="underline" href="https://docs.claude.com/en/docs/claude-code/setup" target="_blank" rel="noreferrer"><code>claude</code> CLI</a>{" "}
                          (logged in via <code className="rounded bg-muted px-1">claude</code>)
                        </li>
                      )}
                      {runtime === "codex" && (
                        <li>
                          • The <a className="underline" href="https://platform.openai.com/docs/codex/cli" target="_blank" rel="noreferrer"><code>codex</code> CLI</a>{" "}
                          (logged in via <code className="rounded bg-muted px-1">codex login</code>)
                        </li>
                      )}
                      {runtime === "openclaw" && (
                        <>
                          <li>
                            • The <a className="underline" href="https://github.com/openclaw/openclaw" target="_blank" rel="noreferrer"><code>openclaw</code> CLI</a>{" "}
                            installed via <code className="rounded bg-muted px-1">npm i -g openclaw</code>
                          </li>
                          <li>
                            • Daemon running — start with{" "}
                            <code className="rounded bg-muted px-1">openclaw onboard --install-daemon</code>
                          </li>
                        </>
                      )}
                      {runtime === "hermes" && (
                        <>
                          <li>
                            • The <a className="underline" href="https://hermes-agent.nousresearch.com/" target="_blank" rel="noreferrer"><code>hermes</code> CLI</a>{" "}
                            installed via the one-line curl on the site above
                          </li>
                          <li>
                            • Daemon running — start with <code className="rounded bg-muted px-1">hermes start</code>, verify with <code className="rounded bg-muted px-1">hermes status</code>
                          </li>
                        </>
                      )}
                    </ul>
                  </div>

                  <Button onClick={() => setStep(2)} className="mt-2">
                    {hasExistingBridge ? "Issue a new machine key" : "Continue"}
                  </Button>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3 text-sm">
                  <p>Pick a name for this laptop — you'll see it in your settings.</p>
                  <div className="flex gap-2">
                    <Input value={keyName} onChange={(e) => setKeyName((e.target as HTMLInputElement).value)} placeholder="My Mac" />
                    <Button onClick={createKey} loading={creating}>
                      <KeyRound className="mr-1 h-3.5 w-3.5" /> Issue key
                    </Button>
                  </div>
                  {error && <p className="text-destructive-foreground">{error}</p>}
                  <p className="text-xs text-muted-foreground">
                    Keys are shown once. Treat them like passwords.
                  </p>
                </div>
              )}

              {step === 3 && (issued || resumed) && (
                <div className="space-y-3 text-sm">
                  {resumed ? (
                    <div className="rounded border border-cyan-500/40 bg-cyan-50 p-3 text-xs dark:bg-cyan-950/20">
                      <p className="font-medium text-cyan-700 dark:text-cyan-400">Resumed from a previous session</p>
                      <p className="mt-1 text-muted-foreground">
                        We&apos;re watching for the bridge from key{" "}
                        <code className="rounded bg-muted px-1">{keyName}</code>.
                        Already pasted the command in your terminal? Just keep it running and we&apos;ll detect the connection.
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Lost the command?{" "}
                        <button type="button" className="underline" onClick={() => { void startOverFromStep2(); }}>
                          Start over to issue a fresh key
                        </button>.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* What the command DOES — three-bullet explainer
                          so users aren't pasting a black-box one-liner.
                          Lifted directly from a real install run so the
                          terms match what they'll see in their terminal. */}
                      <div className="rounded border border-cyan-500/30 bg-cyan-50/40 p-2.5 text-[11px] text-muted-foreground dark:bg-cyan-950/10">
                        <p className="font-medium text-foreground">What this command does:</p>
                        <ul className="mt-1 space-y-0.5">
                          <li>1. Downloads <code className="rounded bg-muted px-1">@raltic/bridge</code> via npx (no global install)</li>
                          <li>2. Registers this laptop with your workspace using the API key below</li>
                          <li>3. Stays running in this terminal — watches for messages from your agents</li>
                        </ul>
                      </div>

                      {/* Tabbed install surface. Quick is the default and
                          what 95% of users want; Persistent is for users
                          who want bridge to keep running after closing
                          terminal; Desktop points users to the installed
                          app's authenticated launch flow. */}
                      <div role="tablist" aria-label="Install method" className="flex gap-1 border-b">
                        {[
                          { id: "quick" as const, label: "Quick (recommended)" },
                          { id: "persistent" as const, label: "Persistent" },
                          { id: "desktop" as const, label: "Desktop app" },
                        ].map((t) => {
                          const active = installTab === t.id;
                          return (
                            <button
                              key={t.id}
                              role="tab"
                              aria-selected={active}
                              onClick={() => setInstallTab(t.id)}
                              className={
                                "-mb-px border-b-2 px-2.5 py-1.5 text-xs transition-colors " +
                                (active
                                  ? "border-cyan-500 text-cyan-700 dark:text-cyan-400"
                                  : "border-transparent text-muted-foreground hover:text-foreground")
                              }
                            >
                              {t.label}
                            </button>
                          );
                        })}
                      </div>

                      {installTab === "quick" && (
                        <>
                          <p className="text-xs">Open a terminal on your laptop and run:</p>
                          <CopyableCommand cmd={quickCmd} />
                        </>
                      )}

                      {installTab === "persistent" && (
                        <div className="space-y-2 text-xs">
                          <p>Install once, then run anytime (also works as a launchd/systemd unit):</p>
                          <CopyableCommand cmd={persistentInstall} />
                          <p>Then start the bridge:</p>
                          <CopyableCommand cmd={persistentRun} />
                          <p className="text-muted-foreground">
                            Auto-start on login: see the README&apos;s launchd / systemd snippets.
                          </p>
                        </div>
                      )}

                      {installTab === "desktop" && (
                        <div className="rounded border border-dashed bg-card p-3 text-xs">
                          <p className="font-medium">Desktop app</p>
                          <p className="mt-1 text-muted-foreground">
                            Open Raltic Desktop on this computer, sign in, then click
                            <span className="font-medium text-foreground"> Connect this computer</span>.
                            The app creates a workspace-scoped key and keeps the bridge
                            running from the menu bar.
                          </p>
                        </div>
                      )}

                      {/* What success looks like — fake terminal preview
                          so the user has a visual to match against their
                          REAL terminal output. Without this they don&apos;t
                          know when to consider "it worked". */}
                      <div className="rounded border bg-zinc-950 p-2.5 font-mono text-[10.5px] leading-relaxed text-zinc-300">
                        <p className="text-zinc-500">$ {installTab === "persistent" ? "raltic-bridge setup ck_…" : quickCmd || "npx -y @raltic/bridge setup ck_…"}</p>
                        <p className="text-zinc-400">[bridge] starting</p>
                        <p className="text-zinc-400">[bridge]   server-url={API_URL}</p>
                        <p className="text-zinc-400">[bridge] runtime {runtime} ready</p>
                        <p className="text-zinc-400">[bridge] connected as user=… server=…</p>
                        <p className="text-emerald-400">[bridge] ready — waiting for messages</p>
                      </div>
                    </>
                  )}
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Terminal className="h-3 w-3" />
                    Waiting for the bridge to connect…
                    <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Once it prints <code>[bridge] ready</code> the wizard will advance automatically.
                  </p>

                  {pollTimedOut && (
                    <div className="rounded border border-amber-500/40 bg-amber-50 p-3 text-xs dark:bg-amber-950/20">
                      <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Still waiting after 4 minutes — something&apos;s likely off.
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        We&apos;re still listening if it comes online. Check your terminal for any error output.
                      </p>
                    </div>
                  )}

                  <button type="button"
                    onClick={() => setShowHelp(v => !v)}
                    className="flex w-full items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground">
                    {showHelp ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    Having trouble?
                  </button>
                  {showHelp && (
                    <ul className="space-y-2 rounded border bg-card p-3 text-xs text-muted-foreground">
                      <li>
                        <strong className="text-foreground">Node ≥ 20 not installed?</strong>{" "}
                        Run <code className="rounded bg-muted px-1">node -v</code>. If missing, install from{" "}
                        <a className="underline" href="https://nodejs.org" target="_blank" rel="noreferrer">nodejs.org</a>{" "}
                        or via Homebrew (<code>brew install node</code>).
                      </li>
                      <li>
                        <strong className="text-foreground">Claude CLI missing?</strong>{" "}
                        Run <code className="rounded bg-muted px-1">claude --version</code>. If missing,{" "}
                        <code className="rounded bg-muted px-1">npm install -g @anthropic-ai/claude-code</code>{" "}
                        then <code className="rounded bg-muted px-1">claude</code> once to log in.
                      </li>
                      <li>
                        <strong className="text-foreground">Stale npx cache?</strong>{" "}
                        Try <code className="rounded bg-muted px-1">rm -rf ~/.npm/_npx</code> and re-run the command above.
                      </li>
                      <li>
                        <strong className="text-foreground">Key got pasted with extra characters?</strong>{" "}
                        Re-issue the key{" "}
                        <button type="button" className="underline"
                          onClick={() => { void startOverFromStep2(); }}>
                          (start over from step 2)
                        </button>.
                      </li>
                    </ul>
                  )}
                </div>
              )}

              {step === 4 && (
                <div className="space-y-3 text-sm">
                  <p className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Your bridge is connected. The Onboarding Assistant is online.
                  </p>

                  {/* Per-machine runtime detection strip. Refreshes every
                      3s so users running `codex login` mid-wizard see
                      their state update without manual reload. Renders
                      ALL machines that have used this key (rare but
                      possible — same key on multiple laptops). */}
                  {detectedMachines.length > 0 && detectedMachines.map((machine, idx) => (
                    <div key={machine.fingerprint ?? idx} className="rounded border bg-muted/30 p-2 text-[12px] space-y-1">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {detectedMachines.length === 1 ? "Detected on your laptop" : `Detected on ${machine.hostname ?? "machine " + (idx + 1)}`}
                      </p>
                      {machine.runtimes.map((r) => (
                        <div key={r.id} className="flex items-center gap-1.5">
                          {r.detected && r.authed ? (
                            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
                          ) : r.detected ? (
                            <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
                          ) : (
                            <span className="h-3 w-3 shrink-0 rounded-full bg-zinc-300" />
                          )}
                          <span className="font-medium">
                            {RUNTIME_LABEL[r.id]}
                          </span>
                          <span className="text-muted-foreground">
                            {r.detected && r.authed
                              ? `${r.version ?? ""} ready`
                              : r.detected
                              // external_daemon runtimes (openclaw,
                              // hermes) report needs_login when the
                              // daemon is reachable-but-not-running;
                              // the fix is `start`, not `login`.
                              // Codex review MED.
                              ? (r.id === "openclaw" || r.id === "hermes")
                                ? `installed — daemon not running`
                                : `installed — run \`${r.id} login\``
                              : "not installed"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}

                  {firstReplySeen ? (
                    <p className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Your agent just replied — end-to-end is working.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      Send a message in the DM below and the agent will respond on your laptop. We&apos;ll
                      mark this step done as soon as the first reply lands here.
                    </p>
                  )}
                  <Button onClick={() => {
                    handleDismiss();
                    if (onboardingDmId) router.push(`/s/${serverSlug}/dm/${onboardingDmId}`);
                  }}>
                    <MessageSquare className="mr-1 h-3.5 w-3.5" />
                    {onboardingDmId ? "Open the DM" : "Open my workspace"}
                  </Button>
                </div>
              )}
            </div>
          </CardPanel>
          <CardFooter className="flex justify-between text-xs text-muted-foreground">
            <span>Stuck? See <a className="underline" href="https://github.com/Digidai/raltic#self-hosting" target="_blank" rel="noreferrer">docs</a>.</span>
            <span>Step {step} of 4</span>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function CopyableCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }
  return (
    <div className="rounded border bg-zinc-900 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">terminal</span>
        <button
          onClick={handleCopy}
          className={"flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors " +
            (copied ? "bg-emerald-600/20 text-emerald-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-white")}
        >
          <Copy className="h-3 w-3" />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed">
        {cmd}
      </pre>
    </div>
  );
}

function Step({ n, active, done, title }: { n: number; active: boolean; done: boolean; title: string }) {
  return (
    <li className={"flex items-center gap-2 " + (active ? "font-medium" : done ? "text-muted-foreground" : "text-muted-foreground/60")}>
      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> :
        active ? <Circle className="h-4 w-4 text-foreground" /> :
        <Circle className="h-4 w-4" />}
      <span>Step {n}: {title}</span>
    </li>
  );
}

/** Radio card used on step 1 to pick a runtime (Claude vs Codex).
 *  Card-style instead of a tight radio so the body copy + chip explain
 *  the trade-off inline rather than burying it in a tooltip. */
function RuntimePick({
  id, checked, onChange, title, chip, chipTone, body, installHref,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  chip: string;
  chipTone: "cyan" | "amber" | "violet" | "rose";
  body: string;
  installHref: string;
}) {
  // Per-runtime accent; matches the sidebar runtime-dot palette so
  // the same color identifies the same runtime everywhere.
  const chipColor = {
    cyan:   "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
    amber:  "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    rose:   "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  }[chipTone];
  return (
    <label
      className={
        "flex cursor-pointer flex-col gap-1 rounded-lg border bg-card p-3 transition-colors " +
        (checked ? "border-cyan-500/60 bg-cyan-500/5" : "hover:border-foreground/20")
      }
    >
      <div className="flex items-center gap-2">
        <input
          type="radio"
          name="runtime"
          value={id}
          checked={checked}
          onChange={onChange}
          className="h-3.5 w-3.5"
        />
        <span className="font-medium">{title}</span>
        <span className={`rounded-full px-1.5 py-px text-[9px] font-medium uppercase tracking-wider ${chipColor}`}>
          {chip}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">{body}</p>
      <a
        href={installHref}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[11px] text-muted-foreground underline hover:text-foreground"
      >
        Install instructions →
      </a>
    </label>
  );
}

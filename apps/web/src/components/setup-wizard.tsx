"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/ui/card";
import { CheckCircle2, Circle, Copy, KeyRound, Terminal, MessageSquare } from "lucide-react";

interface Props {
  serverId: string;
  serverSlug: string;
  /** Called when user clicks "I'll do this later" or finishes step 4. */
  onDismiss?: () => void;
}

const API_URL = "https://syncany-api.genedai.workers.dev";

/**
 * 4-step wizard shown to users who haven't connected a bridge yet:
 *   1. Welcome — what Syncany is, what to expect
 *   2. Create a machine API key (one-shot reveal)
 *   3. Run the bridge command on the user's laptop (with poll for connection)
 *   4. Send first message in the onboarding channel
 */
export function SetupWizard({ serverId, serverSlug, onDismiss }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [keyName, setKeyName] = useState("My Mac");
  const [issued, setIssued] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);

  // Once a key has been issued, poll /api/v1/me until we see hasConnectedBridge.
  useEffect(() => {
    if (!issued || bridgeOnline || step !== 3) return;
    const t = setInterval(async () => {
      try {
        const me = await api.me();
        if (me.hasConnectedBridge) {
          setBridgeOnline(true);
          clearInterval(t);
          setStep(4);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(t);
  }, [issued, bridgeOnline, step]);

  async function createKey() {
    setCreating(true); setError(null);
    try {
      const res = await api.createMachineKey({ serverId, name: keyName.trim() || "My Mac" });
      setIssued(res.apiKey);
      setStep(3);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally { setCreating(false); }
  }

  const cmd = issued ? `npx -y @syncany/bridge --api-key ${issued} --server-url ${API_URL}` : "";

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-xl mx-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Set up Syncany</CardTitle>
              <button onClick={onDismiss}
                className="text-xs text-muted-foreground hover:text-foreground">
                I'll do this later →
              </button>
            </div>
            <CardDescription>
              Syncany lets human and AI teammates share channels. Each agent runs as
              a Claude Code process on <em>your own</em> laptop, talking to the
              hosted UI you're looking at right now.
            </CardDescription>
          </CardHeader>
          <CardPanel>
            <ol className="space-y-3 text-sm">
              <Step n={1} active={step === 1} done={step > 1} title="Welcome" />
              <Step n={2} active={step === 2} done={step > 2}
                title="Create a machine API key" />
              <Step n={3} active={step === 3} done={step > 3}
                title={bridgeOnline ? "Bridge connected ✓" : "Run the bridge on your laptop"} />
              <Step n={4} active={step === 4} done={false}
                title="Send your first message" />
            </ol>

            <div className="mt-6 rounded border bg-muted/30 p-4">
              {step === 1 && (
                <div className="space-y-3 text-sm">
                  <p>You'll need: <strong>Node ≥ 20</strong> and the <a className="underline" href="https://docs.claude.com/en/docs/claude-code/setup" target="_blank" rel="noreferrer"><code>claude</code> CLI</a> installed locally.</p>
                  <p>Time: ~2 minutes.</p>
                  <Button onClick={() => setStep(2)} className="mt-2">Get started</Button>
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
                  {error && <p className="text-red-600">{error}</p>}
                  <p className="text-xs text-muted-foreground">
                    Keys are shown once. Treat them like passwords.
                  </p>
                </div>
              )}

              {step === 3 && issued && (
                <div className="space-y-3 text-sm">
                  <p>Open a terminal on your laptop and run:</p>
                  <CopyableCommand cmd={cmd} />
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Terminal className="h-3 w-3" />
                    Waiting for the bridge to connect…
                    <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Once it prints <code>[bridge] ready</code> the wizard will advance automatically.
                  </p>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-3 text-sm">
                  <p className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Your bridge is connected. The Onboarding Assistant agent is now ready to talk.
                  </p>
                  <p>Try sending a message in the <code className="rounded bg-muted px-1">#onboarding-assistant</code> DM — your agent will respond on your laptop and the reply will land here in real time.</p>
                  <Button onClick={() => onDismiss?.()}>
                    <MessageSquare className="mr-1 h-3.5 w-3.5" /> Open my workspace
                  </Button>
                </div>
              )}
            </div>
          </CardPanel>
          <CardFooter className="flex justify-between text-xs text-muted-foreground">
            <span>Stuck? See <a className="underline" href="https://github.com/Digidai/syncany#self-hosting" target="_blank" rel="noreferrer">docs</a>.</span>
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

"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Monitor, PlugZap, ShieldCheck } from "lucide-react";
import { Button } from "@raltic/ui/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { apiOrigin } from "@/lib/auth-client";

type LaunchState = "loading" | "ready" | "connecting" | "connected" | "error";

interface DesktopBridgeApi {
  bridgeStatus: () => Promise<{ running: boolean; serverId: string | null; serverIds?: string[] }>;
  connectBridge?: (cfg: { apiKey: string; serverUrl?: string; serverId: string }) => Promise<{ ok: true; running: boolean; serverId: string | null; serverIds?: string[] }>;
}

declare global {
  interface Window {
    raltic?: DesktopBridgeApi;
  }
}

interface TargetWorkspace {
  id: string;
  slug: string;
  name: string;
}

function desktopKeyName(): string {
  const platform = typeof navigator !== "undefined" ? navigator.platform : "";
  if (/mac/i.test(platform)) return "Raltic Desktop Mac";
  if (/win/i.test(platform)) return "Raltic Desktop Windows";
  if (/linux/i.test(platform)) return "Raltic Desktop Linux";
  return "Raltic Desktop";
}

function workspaceHref(target: TargetWorkspace | null, opts?: { skipBridgeSetup?: boolean }): string {
  if (!target) return "/";
  const href = `/s/${target.slug}`;
  return opts?.skipBridgeSetup ? `${href}?skipBridgeSetup=1` : href;
}

function bridgeServerIdsFromStatus(status: { serverId: string | null; serverIds?: string[] } | null): string[] {
  if (!status) return [];
  return status.serverIds?.length ? status.serverIds : status.serverId ? [status.serverId] : [];
}

export default function DesktopLaunchPage() {
  const router = useRouter();
  const [state, setState] = useState<LaunchState>("loading");
  const [target, setTarget] = useState<TargetWorkspace | null>(null);
  const [bridgeRunning, setBridgeRunning] = useState(false);
  const [bridgeServerIds, setBridgeServerIds] = useState<string[]>([]);
  const [desktopControls, setDesktopControls] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destination = useMemo(() => workspaceHref(target), [target]);
  const skipDestination = useMemo(() => workspaceHref(target, { skipBridgeSetup: true }), [target]);
  const bridgeConnectedToTarget = bridgeRunning && !!target && bridgeServerIds.includes(target.id);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState("loading");
      setError(null);
      try {
        const desktopApi = window.raltic;
        setDesktopControls(!!desktopApi?.connectBridge);

        const [me, bridge] = await Promise.all([
          api.me(),
          desktopApi?.bridgeStatus().catch(() => null) ?? Promise.resolve(null),
        ]);
        if (cancelled) return;

        const fallbackServer = me.servers[0] ?? null;
        const targetId = me.personalServerId ?? me.defaultServerId ?? fallbackServer?.id ?? null;
        const targetSlug = me.personalServerSlug ?? me.defaultServerSlug ?? fallbackServer?.slug ?? null;
        const targetServer = me.servers.find((s) => s.id === targetId) ?? fallbackServer;
        const nextTarget = targetId && targetSlug
          ? { id: targetId, slug: targetSlug, name: targetServer?.name ?? "your workspace" }
          : null;

        setTarget(nextTarget);
        setBridgeRunning(bridge?.running ?? false);
        setBridgeServerIds(bridgeServerIdsFromStatus(bridge));

        if (bridge?.running && nextTarget && bridgeServerIdsFromStatus(bridge).includes(nextTarget.id)) {
          setState("connected");
          window.setTimeout(() => router.replace(`/s/${nextTarget.slug}`), 650);
        } else {
          setState("ready");
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          router.replace(`/login?client=desktop&next=${encodeURIComponent("/desktop/launch")}`);
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function connectThisComputer() {
    if (!target) {
      setError("No workspace is available for this account yet.");
      setState("error");
      return;
    }
    if (!window.raltic?.connectBridge) {
      setError("Desktop bridge controls are not available in this window. Reopen this page from the Raltic desktop app.");
      setState("error");
      return;
    }

    setState("connecting");
    setError(null);
    let issuedKeyId: string | null = null;
    try {
      const issued = await api.createMachineKey({ serverId: target.id, name: desktopKeyName() });
      issuedKeyId = issued.id;
      const result = await window.raltic.connectBridge({ apiKey: issued.apiKey, serverUrl: apiOrigin, serverId: target.id });
      const resultServerIds = bridgeServerIdsFromStatus(result);
      setBridgeRunning(result.running);
      setBridgeServerIds(resultServerIds);
      if (!result.running || !resultServerIds.includes(target.id)) {
        await revokeIssuedKey(issuedKeyId);
        setError("The desktop bridge did not connect to this workspace. The temporary key was revoked; try again from this screen.");
        setState("error");
        return;
      }
      setState("connected");
      window.setTimeout(() => router.replace(`/s/${target.slug}`), 650);
    } catch (e) {
      if (issuedKeyId) await revokeIssuedKey(issuedKeyId);
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  async function revokeIssuedKey(id: string) {
    try { await api.revokeMachineKey(id); }
    catch (e) {
      console.warn("[desktop-launch] revoke of abandoned key failed", { id, error: e });
    }
  }

  function continueToWorkspace() {
    router.replace(destination);
  }

  function skipBridgeSetup() {
    router.replace(skipDestination);
  }

  const loading = state === "loading";
  const connecting = state === "connecting";
  const connected = state === "connected";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <section className="w-full max-w-[760px] rounded-lg border bg-card shadow-sm">
        <div className="grid gap-0 md:grid-cols-[1fr_300px]">
          <div className="p-7 md:p-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-background">
                <Monitor className="h-5 w-5 text-cyan-600" />
              </div>
              <div>
                <h1 className="font-heading text-xl font-semibold">Raltic Desktop</h1>
                <p className="text-sm text-muted-foreground">Connect this computer, then jump into your workspace.</p>
              </div>
            </div>

            <div className="space-y-4">
              <StatusRow
                icon={<ShieldCheck className="h-4 w-4" />}
                label="Account"
                value={target ? `Ready for ${target.name}` : loading ? "Checking session..." : "No workspace found"}
                tone={target ? "ok" : loading ? "muted" : "warn"}
              />
              <StatusRow
                icon={<PlugZap className="h-4 w-4" />}
                label="Bridge"
                value={bridgeConnectedToTarget ? "Connected to this workspace" : bridgeRunning ? "Running for another workspace" : desktopControls ? "Ready to connect" : "Desktop controls unavailable"}
                tone={bridgeConnectedToTarget ? "ok" : bridgeRunning || desktopControls ? "muted" : "warn"}
              />
            </div>

            {error && (
              <div className="mt-5 flex gap-2 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <div className="mt-7 flex flex-col gap-2 sm:flex-row">
              {loading || connected ? (
                <Button className="w-full sm:w-auto" disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {connected ? "Opening workspace..." : "Checking desktop session..."}
                </Button>
              ) : bridgeConnectedToTarget ? (
                <Button className="w-full sm:w-auto" onClick={continueToWorkspace}>
                  Open workspace <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <>
                  <Button className="w-full sm:w-auto" onClick={connectThisComputer} loading={connecting} disabled={!target || !desktopControls || connecting}>
                    Connect this computer
                  </Button>
                  <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={skipBridgeSetup} disabled={!target || connecting}>
                    Skip for now
                  </Button>
                </>
              )}
            </div>
          </div>

          <aside className="border-t bg-background/55 p-6 md:border-l md:border-t-0">
            <div className="space-y-4 text-sm">
              <Step n="1" title="Sign in" body="Use the same Raltic account as the web app." done={!loading && !!target} />
              <Step n="2" title="Connect this computer" body="A per-machine key is created and stored locally with restricted permissions." done={bridgeConnectedToTarget || connected} />
              <Step n="3" title="Work in channels" body="Local agents can read your repo on this machine; only chat crosses the wire." done={connected} />
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function StatusRow({
  icon, label, value, tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "ok" | "warn" | "muted";
}) {
  const toneClass = tone === "ok"
    ? "text-emerald-600"
    : tone === "warn"
      ? "text-amber-600"
      : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border bg-background px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className={toneClass}>{icon}</span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className={`min-w-0 truncate text-right text-sm ${toneClass}`}>{value}</span>
    </div>
  );
}

function Step({ n, title, body, done }: { n: string; title: string; body: string; done: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-card text-[11px] font-semibold">
        {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : n}
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

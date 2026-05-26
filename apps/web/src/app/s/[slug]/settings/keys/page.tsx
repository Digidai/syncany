"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { KeyRound } from "lucide-react";
import { api, type MachineRuntimeRow } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/heroui-pro/card";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Field, FieldLabel, FieldError } from "@/components/heroui-pro/field";
import { ConfirmDialog } from "@/components/heroui-pro/confirm-dialog";
import { KeyCommandBlock, MachineRow } from "@/components/settings-shared";
import { useSettings, SettingsSection } from "../layout";

interface Key {
  id: string; prefix: string; name: string; serverId: string;
  createdAt: number; lastUsedAt: number | null; revokedAt: number | null;
  lastDetectedAt: number | null;
  machines: MachineRuntimeRow[];
}

export default function MachineKeysPage() {
  const { server } = useSettings();
  const { slug } = useParams<{ slug: string }>();
  const [keys, setKeys] = useState<Key[]>([]);
  const [keyName, setKeyName] = useState("");
  const [issued, setIssued] = useState<{ apiKey: string; cmd: string } | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Key | null>(null);

  async function confirmRevokeKey() {
    if (!revokeTarget) return;
    try { await api.revokeMachineKey(revokeTarget.id); reload(); }
    catch (e) { notifyThrown("Couldn't revoke key", e); }
    finally { setRevokeTarget(null); }
  }

  const reload = useCallback(async () => {
    try {
      // Scope to this workspace — previously listed every key the user
      // owned across all workspaces, which leaked unrelated bridge keys.
      const kData = await api.listMachineKeys({ serverId: server.id });
      setKeys(kData.keys as Key[]);
    } catch (e) {
      notifyThrown("Couldn't load machine keys", e);
    }
  }, [server.id]);
  useEffect(() => { reload(); }, [reload]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setKeyError(null);
    try {
      const res = await api.createMachineKey({ serverId: server.id, name: keyName.trim() });
      const apiUrl = process.env.NEXT_PUBLIC_RALTIC_API_URL ?? "https://api.raltic.com";
      const defaultApiUrl = "https://api.raltic.com";
      setIssued({
        apiKey: res.apiKey,
        cmd: apiUrl === defaultApiUrl
          ? `npx -y @raltic/bridge setup ${res.apiKey}`
          : `npx -y @raltic/bridge setup ${res.apiKey} --server-url ${apiUrl}`,
      });
      setKeyName("");
      reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setKeyError(msg);
      notifyThrown("Couldn't create machine key", e);
    }
  }

  return (
    <SettingsSection title="Runtimes" description="Each laptop running the bridge is a runtime that executes your agents locally. Add one per machine; remove when you stop using that machine.">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Bridge keys</CardTitle>
          <CardDescription>
            Create one per laptop where you&apos;ll run the bridge.{" "}
            <Link href={`/s/${slug}?wizard=1`} className="underline text-foreground hover:opacity-80">
              Re-open the setup wizard
            </Link>{" "}
            for guided steps + troubleshooting.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleCreate}>
          <CardPanel>
            <Field>
              <FieldLabel htmlFor="machine-key-name">Key name</FieldLabel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="machine-key-name"
                  value={keyName}
                  placeholder="e.g. macbook-pro"
                  className="min-w-0 flex-1"
                  onChange={(e) => { setKeyName((e.target as HTMLInputElement).value); if (keyError) setKeyError(null); }}
                />
                <Button type="submit" className="w-full sm:w-auto">Create</Button>
              </div>
              {keyError && <FieldError match>{keyError}</FieldError>}
            </Field>
          </CardPanel>
        </form>
        <CardFooter className="flex flex-col gap-3">
          {issued && (
            <div className="w-full space-y-2 rounded-md border bg-emerald-50 p-3 text-xs">
              <p className="font-medium text-emerald-800">
                ✓ Key created. Copy it now — you won&apos;t see it again.
              </p>
              <KeyCommandBlock cmd={issued.cmd} />
            </div>
          )}
          {keys.length > 0 && (
            <ul className="w-full space-y-3">
              {keys.filter((k) => !k.revokedAt).map((k) => (
                <li key={k.id} className="rounded-lg border bg-card/40 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium">{k.name}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{k.prefix}…</span>
                        <ActiveBadge lastUsedAt={k.lastUsedAt} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Created {new Date(k.createdAt).toLocaleDateString()} ·
                        Last used {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="self-start text-destructive-foreground sm:self-auto"
                      onClick={() => setRevokeTarget(k)}
                    >Revoke</Button>
                  </div>
                  {k.machines.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {k.machines.map((m) => <MachineRow key={m.fingerprint} machine={m} />)}
                    </div>
                  ) : (
                    <p className="mt-3 rounded border border-dashed border-zinc-300 px-2 py-1.5 text-[11px] text-muted-foreground">
                      Key never connected. Open the{" "}
                      <Link href={`/s/${slug}?wizard=1`} className="underline text-foreground hover:opacity-80">setup wizard</Link>{" "}
                      for the bridge command + per-runtime install guidance.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardFooter>
      </Card>
      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}
        title={revokeTarget ? `Revoke "${revokeTarget.name}"?` : "Revoke key?"}
        description="Bridges using this key will disconnect on their next request. You can create a new key for the same laptop anytime."
        confirmLabel="Revoke key"
        onConfirm={confirmRevokeKey}
      />
    </SettingsSection>
  );
}

/**
 * Liveness chip for a machine key (= a runtime).
 *
 * Bridge heartbeats every 60s; machine_keys.last_used_at gets bumped
 * on each beat. The page reads that timestamp and renders:
 *   - "Active" (emerald) if heartbeat within the freshness window
 *   - "Idle Nm ago" (zinc) if older
 *   - "Never connected" if last_used_at is null
 *
 * Freshness window is 2× heartbeat interval (120s) so a single dropped
 * beat doesn't flip a healthy bridge to Idle. Past 5 min we trust the
 * staleness — that's beyond normal jitter.
 */
function ActiveBadge({ lastUsedAt }: { lastUsedAt: number | null }) {
  if (lastUsedAt === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-zinc-600">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" /> Never connected
      </span>
    );
  }
  const ageMs = Date.now() - lastUsedAt;
  // Heartbeat cadence is 60s; allow 2x = 120s before flipping to Idle so
  // a single missed beat doesn't make a healthy bridge look broken.
  const FRESH_WINDOW_MS = 120_000;
  if (ageMs < FRESH_WINDOW_MS) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Active
      </span>
    );
  }
  const mins = Math.floor(ageMs / 60_000);
  const label = mins < 60 ? `${mins}m ago`
    : mins < 60 * 24 ? `${Math.floor(mins / 60)}h ago`
    : `${Math.floor(mins / (60 * 24))}d ago`;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-zinc-600">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" /> Idle {label}
    </span>
  );
}

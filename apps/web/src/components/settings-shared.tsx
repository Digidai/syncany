"use client";

// Shared building blocks for the settings tab pages. Extracted from the
// pre-restructure single-page settings/page.tsx so each tab keeps its
// own narrow concerns while these UI helpers stay one source of truth.

import { useState } from "react";
import Link from "next/link";
import { Copy, CheckCircle2, AlertTriangle, Download, WifiOff, type LucideIcon } from "lucide-react";
import { type MachineRuntimeRow, type RuntimeId, RUNTIME_LABEL } from "@/lib/api";
import { notifySuccess, notifyThrown } from "@/lib/notify";
import { Button } from "@/components/heroui-pro/button";
import { Card, CardPanel } from "@/components/heroui-pro/card";
import { Chip } from "@/components/heroui-pro/chip";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// KeyCommandBlock — copyable shell command surface.
// ---------------------------------------------------------------------------
export function KeyCommandBlock({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded border bg-zinc-900 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">terminal</span>
        <Button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(cmd);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          variant="ghost"
          size="xs"
          className={"h-6 text-[11px] " +
            (copied ? "bg-emerald-600/20 text-emerald-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-white")}
        >
          <Copy className="h-3 w-3" />{copied ? "Copied!" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[11px] leading-relaxed">{cmd}</pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-machine runtime detection rows + pills.
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export function MachineRow({ machine }: { machine: MachineRuntimeRow }) {
  const stale = Date.now() - machine.detectedAt > STALE_THRESHOLD_MS;
  return (
    <Card className="!shadow-none">
      <CardPanel className="p-2">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium">{machine.hostname ?? "Unknown machine"}</span>
        <span className="text-[10.5px] text-muted-foreground">
          {humanizeAge(machine.detectedAt)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5 sm:grid sm:grid-cols-2">
        {(["claude", "codex", "openclaw", "hermes"] as RuntimeId[]).map((rid) => {
          const r = machine.runtimes.find((x) => x.id === rid);
          return <RuntimePill key={rid} id={rid} snapshot={r} stale={stale} detectedAt={machine.detectedAt} />;
        })}
      </div>
      </CardPanel>
    </Card>
  );
}

function RuntimePill({
  id, snapshot, stale, detectedAt,
}: {
  id: RuntimeId;
  snapshot: MachineRuntimeRow["runtimes"][number] | undefined;
  stale: boolean;
  detectedAt: number;
}) {
  const state: "ready" | "needs_login" | "not_installed" | "stale" = stale
    ? "stale"
    : !snapshot || !snapshot.detected
    ? "not_installed"
    : !snapshot.authed
    ? "needs_login"
    : "ready";

  const palettes: Record<typeof state, { color: "success" | "warning" | "default"; Icon: LucideIcon }> = {
    ready:         { color: "success", Icon: CheckCircle2 },
    needs_login:   { color: "warning", Icon: AlertTriangle },
    not_installed: { color: "default", Icon: Download },
    stale:         { color: "default", Icon: WifiOff },
  };
  const palette = palettes[state];

  const Icon = palette.Icon;
  const label = state === "ready" ? "Ready"
    : state === "needs_login" ? "Sign-in needed"
    : state === "not_installed" ? "Not installed"
    : "Stale";

  const tooltip =
    state === "ready" && snapshot
      ? `${snapshot.version ?? ""}${snapshot.authMethod === "env" ? " · via env key" : snapshot.authMethod === "oauth" ? " · via login" : ""}`
      : state === "needs_login"
      // openclaw + hermes are external_daemon runtimes — needs_login
      // here means "binary present, daemon not reachable", not a real
      // login command. Detected by review (wizard H1).
      ? id === "openclaw" ? "Start daemon: openclaw onboard --install-daemon"
      : id === "hermes"   ? "Start daemon: hermes start"
      : `Run \`${id} login\` on this laptop`
      : state === "not_installed"
      ? id === "claude"   ? "Run: npm i -g @anthropic-ai/claude-code"
      : id === "codex"    ? "Run: npm i -g @openai/codex && codex login"
      : id === "openclaw" ? "Run: npm i -g openclaw && openclaw onboard --install-daemon"
      : id === "hermes"   ? "Install: curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"
      : "Install this runtime to use it"
      : `Last seen ${humanizeAge(detectedAt)}`;

  return (
    <Chip
      size="sm"
      variant="soft"
      color={palette.color}
      className="min-w-0 justify-start gap-1.5 px-2 py-1.5 text-[11px]"
      aria-label={`${RUNTIME_LABEL[id]}: ${label}. ${tooltip}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate font-medium">{RUNTIME_LABEL[id]}</span>
      <span className="ml-auto shrink-0 text-[10px]">{label}</span>
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// Time formatting — past + future.
// ---------------------------------------------------------------------------

export function humanizeAge(ts: number): string {
  const delta = Date.now() - ts;
  const m = Math.floor(delta / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function humanizeAgeFuture(ts: number): string {
  const delta = ts - Date.now();
  if (delta <= 0) return "expired";
  const h = Math.floor(delta / 3600_000);
  if (h < 24) return `in ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `in ${d}d`;
  const mo = Math.floor(d / 30);
  return `in ${mo}mo`;
}

// ---------------------------------------------------------------------------
// Invite UI helpers.
// ---------------------------------------------------------------------------

export function InvitePresetButton({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant="outline"
      className="h-auto flex-1 justify-start p-3 text-left hover:border-cyan-500/40 hover:bg-cyan-500/5"
    >
      <span className="block">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{detail}</span>
      </span>
    </Button>
  );
}

export function InviteRow({
  invite, onRevoke,
}: {
  invite: { id: string; uses: number; maxUses: number; expiresAt: number | null };
  onRevoke: () => void;
}) {
  const usesLabel = invite.maxUses === 0
    ? `Used ${invite.uses} ${invite.uses === 1 ? "time" : "times"} · unlimited`
    : `Used ${invite.uses} of ${invite.maxUses} ${invite.maxUses === 1 ? "use" : "uses"}`;
  const expiryLabel = invite.expiresAt
    ? `expires ${humanizeAgeFuture(invite.expiresAt)}`
    : "never expires";
  const used = invite.maxUses > 0 && invite.uses >= invite.maxUses;
  const expired = invite.expiresAt !== null && Date.now() > invite.expiresAt;

  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/invite/${invite.id}` : `/invite/${invite.id}`;

  async function copy() {
    try { await navigator.clipboard.writeText(inviteUrl); notifySuccess("Link copied"); }
    catch { notifyThrown("Clipboard blocked", new Error("Browser refused clipboard access")); }
  }

  return (
    <Card render={<li />} className={cn(
      "border-transparent bg-[var(--surface-secondary)] !shadow-none",
      (used || expired) && "opacity-60",
    )}>
      <CardPanel className="flex flex-col gap-3 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {invite.maxUses === 0 ? "Open link" : invite.maxUses === 1 ? "Single-use link" : `Team link (${invite.maxUses} max)`}
          {used && <Chip size="sm" variant="soft" color="default" className="ml-2">used up</Chip>}
          {expired && <Chip size="sm" variant="soft" color="warning" className="ml-2">expired</Chip>}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{usesLabel} · {expiryLabel}</p>
      </div>
      <div className="grid grid-cols-2 gap-1 sm:flex sm:shrink-0">
        <Button type="button" onClick={copy} variant="outline" size="xs" className="text-[11px]">Copy</Button>
        <Button type="button" onClick={onRevoke} variant="danger-soft" size="xs" className="text-[11px]">Revoke</Button>
      </div>
      </CardPanel>
    </Card>
  );
}

// Re-export Link so settings pages can import shared helpers in one go
// without each adding `next/link` themselves.
export { Link };

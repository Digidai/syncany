"use client";

// Shared building blocks for the settings tab pages. Extracted from the
// pre-restructure single-page settings/page.tsx so each tab keeps its
// own narrow concerns while these UI helpers stay one source of truth.

import { useState } from "react";
import Link from "next/link";
import { Copy, CheckCircle2, AlertTriangle, Download, WifiOff } from "lucide-react";
import { type MachineRuntimeRow, type RuntimeId, RUNTIME_LABEL } from "@/lib/api";
import { notifySuccess, notifyThrown } from "@/lib/notify";

// ---------------------------------------------------------------------------
// KeyCommandBlock — copyable shell command surface.
// ---------------------------------------------------------------------------
export function KeyCommandBlock({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded border bg-zinc-900 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">terminal</span>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(cmd);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className={"flex items-center gap-1 rounded px-2 py-0.5 text-[11px] " +
            (copied ? "bg-emerald-600/20 text-emerald-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-white")}
        >
          <Copy className="h-3 w-3" />{copied ? "Copied!" : "Copy"}
        </button>
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
    <div className="rounded border bg-background/40 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium">{machine.hostname ?? "Unknown machine"}</span>
        <span className="text-[10.5px] text-muted-foreground">
          {humanizeAge(machine.detectedAt)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5 sm:grid sm:grid-cols-2">
        {(["claude", "codex"] as RuntimeId[]).map((rid) => {
          const r = machine.runtimes.find((x) => x.id === rid);
          return <RuntimePill key={rid} id={rid} snapshot={r} stale={stale} detectedAt={machine.detectedAt} />;
        })}
      </div>
    </div>
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

  const palette = {
    ready:         { bg: "bg-cyan-50",   text: "text-cyan-800",   border: "border-cyan-200",   Icon: CheckCircle2 },
    needs_login:   { bg: "bg-amber-50",  text: "text-amber-800",  border: "border-amber-200",  Icon: AlertTriangle },
    not_installed: { bg: "bg-zinc-100",  text: "text-zinc-700",   border: "border-zinc-200",   Icon: Download },
    stale:         { bg: "bg-zinc-100",  text: "text-zinc-500 italic", border: "border-zinc-300 border-dashed", Icon: WifiOff },
  }[state];

  const Icon = palette.Icon;
  const label = state === "ready" ? "Ready"
    : state === "needs_login" ? "Sign-in needed"
    : state === "not_installed" ? "Not installed"
    : "Stale";

  const tooltip =
    state === "ready" && snapshot
      ? `${snapshot.version ?? ""}${snapshot.authMethod === "env" ? " · via env key" : snapshot.authMethod === "oauth" ? " · via login" : ""}`
      : state === "needs_login"
      ? `Run \`${id} login\` on this laptop`
      : state === "not_installed"
      ? id === "claude"
        ? "Run: npm i -g @anthropic-ai/claude-code"
        : "Run: npm i -g @openai/codex && codex login"
      : `Last seen ${humanizeAge(detectedAt)}`;

  return (
    <div
      className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] ${palette.bg} ${palette.text} ${palette.border}`}
      title={tooltip}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium">{RUNTIME_LABEL[id]}</span>
      <span className="ml-auto text-[10px]">{label}</span>
    </div>
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
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-lg border border-border bg-card/40 p-3 text-left transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/5"
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>
    </button>
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
    <li className={`flex items-center justify-between gap-3 rounded-lg border bg-card/40 p-3 text-sm ${used || expired ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {invite.maxUses === 0 ? "Open link" : invite.maxUses === 1 ? "Single-use link" : `Team link (${invite.maxUses} max)`}
          {used && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">used up</span>}
          {expired && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">expired</span>}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{usesLabel} · {expiryLabel}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <button onClick={copy} className="rounded-md border px-2 py-1 text-[11px] hover:bg-accent">Copy</button>
        <button onClick={onRevoke} className="rounded-md border border-destructive/30 px-2 py-1 text-[11px] text-destructive-foreground hover:bg-destructive/10">Revoke</button>
      </div>
    </li>
  );
}

// Re-export Link so settings pages can import shared helpers in one go
// without each adding `next/link` themselves.
export { Link };

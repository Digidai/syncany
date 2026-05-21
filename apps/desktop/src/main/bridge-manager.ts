/**
 * Bridge lifecycle wrapper — start/stop/restart with shared state so the
 * tray menu, settings save, and auto-update all act on the same instance.
 *
 * Phase D5 had the bridge as a single-shot startBridge() in index.ts. D6
 * adds "restart after config save" so the user can paste a new API key
 * without quitting the app. The wrapper keeps the "only one bridge at a
 * time" invariant and serializes start/stop so back-to-back save clicks
 * can't race two bridges into existence.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { Bridge, type BridgeOpts } from "@raltic/bridge-core";
import { loadConfig } from "./config.js";

let current: Bridge | null = null;
let inflight: Promise<void> | null = null;

export function isRunning(): boolean {
  return current !== null;
}

export async function startBridge(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    if (current) return;
    const cfg = loadConfig();
    if (!cfg.apiKey) {
      console.log("[desktop] no API key configured — bridge idle. Open Settings to add one.");
      return;
    }
    mkdirSync(join(homedir(), ".raltic", "agents"), { recursive: true });
    const opts: BridgeOpts = {
      serverUrl: cfg.serverUrl ?? "https://api.raltic.com",
      apiKey: cfg.apiKey,
      agentsDir: join(homedir(), ".raltic", "agents"),
    };
    const b = new Bridge(opts);
    try {
      await b.start();
      current = b;
      console.log("[desktop] bridge started");
    } catch (e) {
      console.error("[desktop] bridge start failed:", e);
      try { await b.stop(); } catch { /* best-effort cleanup */ }
    }
  })();
  try { await inflight; }
  finally { inflight = null; }
}

export async function stopBridge(): Promise<void> {
  if (inflight) return inflight;
  // Hold the lock during stop too — without it, a concurrent startBridge
  // would see `current=null` AND `inflight=null` and spawn a fresh
  // Bridge while the old one's WebSocket is still draining.
  inflight = (async () => {
    if (!current) return;
    const b = current;
    current = null;
    try { await b.stop(); }
    catch (e) { console.warn("[desktop] bridge stop error:", e); }
  })();
  try { await inflight; }
  finally { inflight = null; }
}

export async function restartBridge(): Promise<void> {
  await stopBridge();
  await startBridge();
}

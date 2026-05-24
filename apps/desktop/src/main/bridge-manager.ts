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
let operationQueue: Promise<void> = Promise.resolve();

export function isRunning(): boolean {
  return current !== null;
}

function enqueue(fn: () => Promise<void>): Promise<void> {
  const next = operationQueue.then(fn, fn);
  operationQueue = next.catch(() => { /* keep later operations unblocked */ });
  return next;
}

async function startBridgeUnlocked(): Promise<void> {
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
}

async function stopBridgeUnlocked(): Promise<void> {
  if (!current) return;
  const b = current;
  current = null;
  try { await b.stop(); }
  catch (e) { console.warn("[desktop] bridge stop error:", e); }
}

export function startBridge(): Promise<void> {
  return enqueue(startBridgeUnlocked);
}

export function stopBridge(): Promise<void> {
  return enqueue(stopBridgeUnlocked);
}

export async function restartBridge(): Promise<void> {
  return enqueue(async () => {
    await stopBridgeUnlocked();
    await startBridgeUnlocked();
  });
}

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
import { bridgeKeysFromConfig, loadConfig, type DesktopBridgeKey } from "./config.js";

interface RunningBridge {
  apiKey: string;
  bridge: Bridge;
}

let current = new Map<string, RunningBridge>();
let operationQueue: Promise<void> = Promise.resolve();

export function isRunning(): boolean {
  return current.size > 0;
}

export function runningServerIds(): string[] {
  const ids = new Set<string>();
  for (const entry of current.values()) {
    const id = entry.bridge.getServerId();
    if (id) ids.add(id);
  }
  return [...ids];
}

export function runningServerId(): string | null {
  return runningServerIds()[0] ?? null;
}

function enqueue(fn: () => Promise<void>): Promise<void> {
  const next = operationQueue.then(fn, fn);
  operationQueue = next.catch(() => { /* keep later operations unblocked */ });
  return next;
}

async function startBridgeUnlocked(): Promise<void> {
  if (current.size > 0) return;
  const cfg = loadConfig();
  const keys = bridgeKeysFromConfig(cfg);
  if (keys.length === 0) {
    console.log("[desktop] no API key configured — bridge idle. Open Settings to add one.");
    return;
  }
  const agentsRoot = join(homedir(), ".raltic", "agents");
  mkdirSync(agentsRoot, { recursive: true });

  const results = await Promise.all(keys.map((key) => startOneBridge(key, agentsRoot)));
  const started = results.filter((entry): entry is RunningBridge => entry !== null);
  current = new Map(started.map((entry) => [entry.apiKey, entry]));
  if (started.length === 0) {
    console.error(`[desktop] all ${keys.length} bridge key(s) failed to start`);
    return;
  }
  if (started.length < keys.length) {
    console.warn(`[desktop] ${keys.length - started.length}/${keys.length} bridge key(s) failed; remaining workspaces keep running`);
  }
  console.log(`[desktop] bridge started for ${started.length} workspace key(s)`);
}

async function stopBridgeUnlocked(): Promise<void> {
  if (current.size === 0) return;
  const bridges = [...current.values()];
  current = new Map();
  await Promise.all(bridges.map(async ({ bridge }) => {
    try { await bridge.stop(); }
    catch (e) { console.warn("[desktop] bridge stop error:", e); }
  }));
}

async function startOneBridge(key: DesktopBridgeKey, agentsRoot: string): Promise<RunningBridge | null> {
  const opts: BridgeOpts = {
    serverUrl: key.serverUrl ?? "https://api.raltic.com",
    apiKey: key.apiKey,
    agentsDir: join(agentsRoot, keyPrefix(key.apiKey)),
  };
  const bridge = new Bridge(opts);
  try {
    await bridge.start();
    console.log(`[desktop] bridge key ${keyPrefix(key.apiKey)} connected to server=${bridge.getServerId() ?? "unknown"}`);
    return { apiKey: key.apiKey, bridge };
  } catch (e) {
    console.error(`[desktop] bridge key ${keyPrefix(key.apiKey)} start failed:`, e);
    try { await bridge.stop(); } catch { /* best-effort cleanup */ }
    return null;
  }
}

function keyPrefix(apiKey: string): string {
  return apiKey.slice(0, 12).replace(/[^a-zA-Z0-9_-]/g, "_");
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

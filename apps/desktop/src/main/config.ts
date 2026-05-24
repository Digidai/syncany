/**
 * Desktop config store — single source of truth for the API key + server
 * URL the bridge uses. Lives at ~/.raltic/desktop/config.json with 0600
 * perms (refused otherwise; codex security review F4).
 *
 * Writes are atomic (write-temp + rename) so a crash mid-write can't
 * leave the user with a half-written file the loader will refuse. Each
 * save uses a unique temp name so two near-simultaneous saves can't
 * clobber each other's .tmp midflight (codex R4 F1).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import {
  existsSync, readFileSync, writeFileSync, renameSync, lstatSync,
  mkdirSync, chmodSync, unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

export const CONFIG_DIR = join(homedir(), ".raltic", "desktop");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export interface DesktopConfig {
  apiKey?: string;
  serverUrl?: string;
  serverId?: string;
  keys?: DesktopBridgeKey[];
}

export interface DesktopBridgeKey {
  apiKey: string;
  serverUrl?: string;
  serverId?: string;
  addedAt?: number;
}

export function loadConfig(): DesktopConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const st = lstatSync(CONFIG_PATH);
    if (!st.isFile()) {
      console.warn("[desktop] config.json is not a regular file — refusing to read");
      return {};
    }
    if (process.platform !== "win32" && (st.mode & 0o077) !== 0) {
      console.warn(
        `[desktop] config.json mode ${(st.mode & 0o777).toString(8)} ` +
        `is group/world-readable — refusing to read. Run: chmod 600 ${CONFIG_PATH}`,
      );
      return {};
    }
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as DesktopConfig;
  } catch (e) {
    console.warn("[desktop] failed to read config.json:", e instanceof Error ? e.message : e);
    return {};
  }
}

/**
 * Normalize a server URL: trim, lowercase host, drop trailing slash on
 * the path, validate it parses as http(s). Returns undefined for inputs
 * that fail to parse — callers should treat that as "user gave us junk,
 * fall back to defaults".
 */
function normalizeServerUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.endsWith("/") && u.pathname.length > 1) {
      u.pathname = u.pathname.slice(0, -1);
    }
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function normalizeBridgeKey(raw: Partial<DesktopBridgeKey>): DesktopBridgeKey | null {
  const apiKey = raw.apiKey?.trim();
  if (!apiKey) return null;
  const normalized: DesktopBridgeKey = { apiKey };
  if (raw.serverUrl?.trim()) {
    const u = normalizeServerUrl(raw.serverUrl);
    if (u) normalized.serverUrl = u;
  }
  if (raw.serverId?.trim()) normalized.serverId = raw.serverId.trim();
  if (typeof raw.addedAt === "number" && Number.isFinite(raw.addedAt)) {
    normalized.addedAt = raw.addedAt;
  }
  return normalized;
}

export function bridgeKeysFromConfig(cfg: DesktopConfig): DesktopBridgeKey[] {
  const keys: DesktopBridgeKey[] = [];
  const seenApiKeys = new Set<string>();
  const add = (raw: Partial<DesktopBridgeKey>) => {
    const normalized = normalizeBridgeKey(raw);
    if (!normalized || seenApiKeys.has(normalized.apiKey)) return;
    seenApiKeys.add(normalized.apiKey);
    keys.push(normalized);
  };

  add({
    apiKey: cfg.apiKey,
    serverUrl: cfg.serverUrl,
    serverId: cfg.serverId,
  });
  if (Array.isArray(cfg.keys)) {
    for (const entry of cfg.keys) {
      if (entry && typeof entry === "object") add(entry);
    }
  }
  return keys;
}

function configFromKeys(keys: DesktopBridgeKey[]): DesktopConfig {
  const primary = keys[0];
  if (!primary) return {};
  return {
    apiKey: primary.apiKey,
    serverUrl: primary.serverUrl,
    serverId: primary.serverId,
    keys,
  };
}

export function upsertBridgeKey(cfg: DesktopConfig, key: DesktopBridgeKey): DesktopConfig {
  const normalized = normalizeBridgeKey({ ...key, addedAt: key.addedAt ?? Date.now() });
  if (!normalized) return cfg;

  const keys = bridgeKeysFromConfig(cfg).filter((existing) => {
    if (existing.apiKey === normalized.apiKey) return false;
    return !(normalized.serverId && existing.serverId === normalized.serverId);
  });
  keys.push(normalized);
  return configFromKeys(keys);
}

export function replacePrimaryBridgeKey(cfg: DesktopConfig, key: DesktopConfig): DesktopConfig {
  const normalized = normalizeBridgeKey({
    apiKey: key.apiKey,
    serverUrl: key.serverUrl,
    serverId: key.serverId,
    addedAt: Date.now(),
  });
  if (!normalized) return {};

  const rest = bridgeKeysFromConfig(cfg).slice(1);
  return configFromKeys([normalized, ...rest]);
}

export function saveConfig(cfg: DesktopConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    try { chmodSync(CONFIG_DIR, 0o700); } catch { /* best-effort */ }
  }
  const normalized = configFromKeys(bridgeKeysFromConfig(cfg));
  // Unique temp per save so two near-simultaneous calls can't both try
  // to write the same .tmp path and clobber each other.
  const tmp = `${CONFIG_PATH}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(normalized, null, 2), { mode: 0o600 });
    renameSync(tmp, CONFIG_PATH);
  } catch (e) {
    // Don't leak .tmp on failure.
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw e;
  }
  if (process.platform !== "win32") {
    try { chmodSync(CONFIG_PATH, 0o600); } catch { /* best-effort */ }
  }
}

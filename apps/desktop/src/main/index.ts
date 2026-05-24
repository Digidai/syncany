/**
 * Raltic desktop — Electron main process.
 *
 * Responsibilities (Phase D5/D6/D7):
 *   D5: open a single window pointed at https://raltic.com + boot the
 *       bridge in-process so the user doesn't need a separate npx terminal.
 *   D6: system tray that survives window close, settings window for
 *       editing the API key without quitting, IPC bridge for renderer↔main.
 *   D7: electron-updater wired to a publish channel (no-op in dev, fails
 *       soft if signature verification fails).
 *
 * Hard rule: anything renderer-exposed via preload goes through a
 * narrowly-typed IPC contract — do NOT widen window.raltic to expose
 * shell.openExternal or node:fs directly. Each handler validates its
 * input before touching state.
 */
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startBridge, stopBridge, restartBridge, isRunning,
  runningServerId, runningServerIds,
} from "./bridge-manager.js";
import {
  bridgeKeysFromConfig, loadConfig, replacePrimaryBridgeKey,
  saveConfig, upsertBridgeKey, type DesktopConfig,
} from "./config.js";
import { createTray, rebuildMenu, destroyTray, isTrayAlive } from "./tray.js";
import { initAutoUpdater, teardownAutoUpdater, checkForUpdates } from "./updater.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WEB_URL = process.env.RALTIC_WEB_URL ?? "https://raltic.com";
const WEB_ORIGIN = new URL(WEB_URL).origin;
const DESKTOP_LAUNCH_PATH = process.env.RALTIC_DESKTOP_LAUNCH_PATH ?? "/desktop/launch";
const DESKTOP_LAUNCH_URL = new URL(DESKTOP_LAUNCH_PATH, WEB_ORIGIN).toString();
const DESKTOP_LAUNCH_PATHNAME = new URL(DESKTOP_LAUNCH_PATH, WEB_ORIGIN).pathname;
const BRIDGE_API_URL = process.env.RALTIC_API_URL ?? "https://api.raltic.com";
const BRIDGE_API_ORIGIN = new URL(BRIDGE_API_URL).origin;
const PRELOAD_PATH = join(__dirname, "../preload/index.cjs");

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

function safeOpenExternal(rawUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(rawUrl); }
  catch { return; }
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return;
  void shell.openExternal(parsed.toString()).catch((e) => {
    console.warn("[desktop] shell.openExternal failed:", e instanceof Error ? e.message : e);
  });
}

function isTrustedUrl(rawUrl: string): boolean {
  try { return new URL(rawUrl).origin === WEB_ORIGIN; }
  catch { return false; }
}

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
// Set true on explicit Quit (tray menu or Cmd-Q); used to bypass the
// "hide instead of quit on window close" behavior.
let quitting = false;

function createMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) return { action: "allow" };
    safeOpenExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedUrl(url)) return;
    event.preventDefault();
    safeOpenExternal(url);
  });

  // Hide instead of quit on close — the tray is the persistent surface.
  // The user "quits" via tray menu or Cmd-Q (which sets quitting=true).
  //
  // Linux/Windows fallback: if the tray failed to materialize (some
  // Linux DEs strip the system tray, the user disabled it, etc.),
  // hiding here traps the user with no way to bring the window back.
  // Fall through to a real close in that case.
  mainWindow.on("close", (event) => {
    if (quitting) return;
    if (process.platform !== "darwin" && !isTrayAlive()) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  void mainWindow.loadURL(DESKTOP_LAUNCH_URL);
}

function createSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 420,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: "#0a0a0a",
    title: "Raltic Settings",
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.on("closed", () => { settingsWindow = null; });
  // Lock the settings window to its initial file/dev origin. Without
  // this guard, a click or scripted navigation could take settings to
  // an attacker page that inherits the "is settings window" trust
  // (the IPC handlers gate on webContents.id, not URL). Block ALL
  // top-level navigation + popups; deny attempts loudly so a stray
  // <a> click in settings.html is obvious in logs.
  settingsWindow.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    console.warn("[desktop] settings: blocked navigation to", url);
  });
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn("[desktop] settings: blocked window.open to", url);
    safeOpenExternal(url);
    return { action: "deny" };
  });
  // Local file load — the settings renderer is bundled into out/renderer/.
  // Production assets live next to the main bundle; dev uses Vite's
  // dev-server URL (electron-vite injects ELECTRON_RENDERER_URL).
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void settingsWindow.loadURL(`${devUrl}/settings.html`);
  } else {
    void settingsWindow.loadFile(join(__dirname, "../renderer/settings.html"));
  }
}

// ---------------------------------------------------------------------------
// IPC contract (renderer → main). Keep narrow + validated.
//
// Origin gating: config:* handlers MUST only accept events whose sender
// is the settings window. Without this, https://raltic.com (loaded in
// the main window with the same preload) could call saveConfig() and
// either exfiltrate the API key via getConfig or pivot the bridge to an
// attacker-controlled serverUrl. (Codex R4-1 F1.)
// ---------------------------------------------------------------------------

// Conservative key/URL validation. The reason for length caps isn't
// "DoS the bridge" — it's "stop a malicious renderer from persisting
// junk that breaks the bridge silently on next start". Real keys are
// `ck_<32-48 url-safe>`; allow a generous range so we don't reject
// future key formats.
const API_KEY_RE = /^ck_[A-Za-z0-9_-]{8,256}$/;
const SERVER_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_SERVER_URL_LEN = 512;

function hasControlChars(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x1f]/.test(s);
}

function normalizeAllowedBridgeServerUrl(raw?: string): string | null {
  const source = raw?.trim() || BRIDGE_API_URL;
  if (!source || source.length > MAX_SERVER_URL_LEN || hasControlChars(source)) return null;
  try {
    const u = new URL(source);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.origin !== BRIDGE_API_ORIGIN) return null;
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.endsWith("/") && u.pathname.length > 1) {
      u.pathname = u.pathname.slice(0, -1);
    }
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isPlainConfig(x: unknown): x is DesktopConfig {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o.apiKey !== undefined) {
    if (typeof o.apiKey !== "string") return false;
    // Empty string = "user wants to clear the key" — allowed; the save
    // path normalizes empty/whitespace to "no key".
    const trimmed = o.apiKey.trim();
    if (trimmed && !API_KEY_RE.test(trimmed)) return false;
  }
  if (o.serverUrl !== undefined) {
    if (typeof o.serverUrl !== "string") return false;
    if (o.serverUrl.length > MAX_SERVER_URL_LEN) return false;
    // Reject control chars / NUL bytes — bridge passes URL to fetch()
    // which can have quirky behavior with embedded control characters.
    if (hasControlChars(o.serverUrl)) return false;
  }
  if (o.serverId !== undefined) {
    if (typeof o.serverId !== "string") return false;
    const trimmed = o.serverId.trim();
    if (trimmed && !SERVER_ID_RE.test(trimmed)) return false;
  }
  // The settings window edits the primary key only. Multi-key config is
  // managed by the authenticated /desktop/launch flow so arbitrary pages
  // cannot inject a key list through the generic config editor.
  if (o.keys !== undefined) return false;
  return true;
}

function parseDesktopConnectPayload(x: unknown): DesktopConfig | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.apiKey !== "string") return null;
  const apiKey = o.apiKey.trim();
  if (!API_KEY_RE.test(apiKey)) return null;
  if (typeof o.serverId !== "string") return null;
  const serverId = o.serverId.trim();
  if (!SERVER_ID_RE.test(serverId)) return null;
  if (o.serverUrl !== undefined && typeof o.serverUrl !== "string") return null;
  const serverUrl = normalizeAllowedBridgeServerUrl(o.serverUrl);
  if (!serverUrl) return null;
  return { apiKey, serverUrl, serverId };
}

function fromSettingsWindow(event: Electron.IpcMainInvokeEvent): boolean {
  // sender comparison — settingsWindow may be null if the window hasn't
  // been opened. If a config:* event arrives with no settings window
  // open, by definition it can't be coming from settings → reject.
  return !!settingsWindow && event.sender.id === settingsWindow.webContents.id;
}

function fromDesktopLaunchSurface(event: Electron.IpcMainInvokeEvent): boolean {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) return false;
  if (event.senderFrame !== event.sender.mainFrame) return false;
  const rawUrl = event.senderFrame?.url ?? event.sender.getURL();
  try {
    const url = new URL(rawUrl);
    return url.origin === WEB_ORIGIN && url.pathname === DESKTOP_LAUNCH_PATHNAME;
  } catch {
    return false;
  }
}

let configMutationQueue: Promise<unknown> = Promise.resolve();
function enqueueConfigMutation<T>(fn: () => Promise<T>): Promise<T> {
  const next = configMutationQueue.then(fn, fn);
  configMutationQueue = next.catch(() => { /* keep later saves unblocked */ });
  return next;
}

interface BridgeStatusPayload {
  ok?: true;
  running: boolean;
  serverId: string | null;
  serverIds: string[];
  configuredServerIds: string[];
}

function bridgeStatusPayload(ok?: true): BridgeStatusPayload {
  const cfg = loadConfig();
  const configuredServerIds = bridgeKeysFromConfig(cfg)
    .map((key) => key.serverId)
    .filter((id): id is string => !!id);
  const serverIds = isRunning() ? runningServerIds() : [];
  return {
    ...(ok ? { ok } : {}),
    running: isRunning(),
    serverId: isRunning() ? runningServerId() : null,
    serverIds,
    configuredServerIds,
  };
}

async function replacePrimaryConfigAndRestart(next: DesktopConfig): Promise<BridgeStatusPayload> {
  return enqueueConfigMutation(async () => {
    saveConfig(replacePrimaryBridgeKey(loadConfig(), next));
    await restartBridge();
    rebuildMenu(trayOpts());
    return bridgeStatusPayload(true);
  });
}

async function addBridgeConfigAndRestart(next: DesktopConfig): Promise<BridgeStatusPayload> {
  return enqueueConfigMutation(async () => {
    if (!next.apiKey || !next.serverId) throw new Error("missing bridge key");
    saveConfig(upsertBridgeKey(loadConfig(), {
      apiKey: next.apiKey,
      serverUrl: next.serverUrl,
      serverId: next.serverId,
    }));
    await restartBridge();
    rebuildMenu(trayOpts());
    return bridgeStatusPayload(true);
  });
}

function registerIpc(): void {
  ipcMain.handle("config:get", (e) => {
    if (!fromSettingsWindow(e)) throw new Error("forbidden");
    return loadConfig();
  });
  ipcMain.handle("config:save", async (e, next: unknown) => {
    if (!fromSettingsWindow(e)) throw new Error("forbidden");
    if (!isPlainConfig(next)) throw new Error("invalid config payload");
    return replacePrimaryConfigAndRestart(next);
  });
  ipcMain.handle("bridge:connect", async (e, next: unknown) => {
    if (!fromSettingsWindow(e) && !fromDesktopLaunchSurface(e)) throw new Error("forbidden");
    const parsed = parseDesktopConnectPayload(next);
    if (!parsed) throw new Error("invalid bridge payload");
    return addBridgeConfigAndRestart(parsed);
  });
  ipcMain.handle("bridge:status", () => {
    return bridgeStatusPayload();
  });
  // updater:check is also settings-only — the main raltic.com window
  // shares this preload, and we don't want a compromised/curious page
  // to spam the update server.
  ipcMain.handle("updater:check", async (e) => {
    if (!fromSettingsWindow(e)) throw new Error("forbidden");
    await checkForUpdates();
    return { ok: true };
  });
}

function trayOpts() {
  return {
    showMain: () => createMainWindow(),
    showSettings: () => createSettingsWindow(),
    quit: () => {
      quitting = true;
      app.quit();
    },
  };
}

app.whenReady().then(() => {
  registerIpc();
  // Tray creation can throw on Linux DEs that strip the system tray —
  // continuing without a tray is safer than refusing to launch.
  try { createTray(trayOpts()); }
  catch (e) { console.warn("[desktop] tray creation failed:", e); }
  createMainWindow();
  void startBridge()
    .catch((e) => { console.error("[desktop] startBridge fatal:", e); })
    .finally(() => rebuildMenu(trayOpts()));
  initAutoUpdater(() => mainWindow);

  // createMainWindow self-handles "exists → show+focus; doesn't exist → create".
  app.on("activate", () => createMainWindow());
});

// Tray keeps the app alive, so the default "quit on last window closed"
// behavior would be wrong. We never quit from window-all-closed; the
// user quits via tray.
app.on("window-all-closed", () => { /* intentionally empty */ });

// Re-entry guard: before-quit runs once. If another app.quit() arrives
// while we're mid-teardown (cmd-Q twice, tray click during shutdown),
// we don't restart teardown — just preventDefault and let the existing
// run finish into app.exit(0).
let quitInProgress = false;
app.on("before-quit", async (event) => {
  if (quitInProgress) { event.preventDefault(); return; }
  quitInProgress = true;
  quitting = true;
  event.preventDefault();
  teardownAutoUpdater();
  destroyTray();
  try {
    settingsWindow?.destroy();
  } catch { /* best-effort */ }
  try {
    await Promise.race([
      stopBridge(),
      new Promise<void>((r) => setTimeout(r, 1500)),
    ]);
  } catch (e) {
    console.warn("[desktop] stopBridge during quit:", e);
  }
  app.exit(0);
});

/**
 * PlatformAdapter — abstraction over host-specific capabilities.
 *
 * `packages/ui` is a single source of truth for React components + hooks
 * shared between the Next.js web host and the future Electron desktop host.
 * Anything that differs between the two hosts (navigation, OS notifications,
 * clipboard, file downloads, bridge process control) lives behind this
 * interface so UI code never imports `next/*` or `electron`.
 *
 * Each host provides its own implementation:
 *   • apps/web/src/platform.ts        → WebPlatformAdapter
 *   • apps/desktop/src/.../platform.ts → ElectronPlatformAdapter
 *
 * Required capabilities are bare methods; host-only capabilities are
 * optional (`?:`) — UI code uses `platform.bridge?.start(...)` so a
 * host without that capability compiles cleanly + the call no-ops.
 *
 * Design rules:
 *   1. NO host imports here (no next/navigation, no electron). The
 *      adapter type stays as a pure description; hosts wire it up.
 *   2. Methods return Promises where IPC might be involved (desktop
 *      crosses the renderer↔main process boundary). Web impls can
 *      return synchronously inside a Promise.resolve().
 *   3. Subscriptions return an unsubscribe function — never use raw
 *      event-emitter "off(event, handler)" pairs; they're error-prone
 *      across IPC.
 *
 * Adding a new capability:
 *   1. Add field here with explicit JSDoc on usage + which hosts implement.
 *   2. Implement in WebPlatformAdapter + ElectronPlatformAdapter
 *      (the latter via IPC if it needs main-process access).
 *   3. Use it from UI via `usePlatform()` hook (see providers/).
 */

export type PlatformKind = "web" | "desktop-mac" | "desktop-win" | "desktop-linux";

export interface NotifyOptions {
  title: string;
  body: string;
  /** URL to a small icon (PNG recommended). Web: Notification.icon;
   *  Desktop: NSImage / nativeImage. */
  icon?: string;
  /** Called when the user clicks the notification. */
  onClick?: () => void;
  /** Auto-dismiss timeout (ms). Some platforms ignore this. */
  timeoutMs?: number;
}

export interface ClipboardAPI {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export interface StorageAPI {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Optional desktop-only: control the embedded bridge daemon. */
export interface BridgeControlAPI {
  start(opts: { apiKey: string; serverUrl: string }): Promise<void>;
  stop(): Promise<void>;
  /** "stopped" → never started; "connecting" → handshake in flight;
   *  "connected" → WS up + agents bootstrapped; "error" → last
   *  attempt failed (lastError populated). */
  getStatus(): "stopped" | "connecting" | "connected" | "error";
  onStatusChange(cb: (status: ReturnType<BridgeControlAPI["getStatus"]>, lastError?: string) => void): () => void;
  /** Subscribe to log lines for the desktop log viewer. Lines are raw
   *  text in the bridge's normal format; consumer is free to filter. */
  onLog(cb: (line: string) => void): () => void;
}

/** Optional desktop-only: window controls (minimise, dock badge, etc.). */
export interface WindowControlAPI {
  minimize(): void;
  setAlwaysOnTop(value: boolean): void;
  /** macOS dock badge count. No-op on Win/Linux. */
  setBadgeCount(n: number): void;
}

/** Optional desktop-only: in-app auto-update controls. */
export interface UpdateAPI {
  check(): Promise<{ available: boolean; version?: string }>;
  download(): Promise<void>;
  applyAndRestart(): void;
  onProgress(cb: (percent: number) => void): () => void;
}

export interface PlatformAdapter {
  // ── Host identification ────────────────────────────────────────────────
  readonly kind: PlatformKind;
  /** App version string (e.g. "0.4.2"). Used for telemetry tags. */
  readonly version: string;

  // ── Navigation ─────────────────────────────────────────────────────────
  /** Programmatic navigation. Web: next/router push; Desktop: in-app
   *  router push. ALWAYS use this over `window.location` so the desktop
   *  host doesn't accidentally reload its main BrowserWindow. */
  navigate(path: string): void;
  /** Current absolute pathname (no host). */
  getCurrentPath(): string;
  /** Subscribe to path changes. Returns unsubscribe. */
  onPathChange(cb: (path: string) => void): () => void;

  // ── Persistence ────────────────────────────────────────────────────────
  /** Async key-value local store. Web: localStorage wrapper. Desktop:
   *  electron-store on disk so prefs survive app reinstall. */
  storage: StorageAPI;

  // ── User-facing OS surfaces ────────────────────────────────────────────
  /** OS-level notification (web: Notification API; desktop: native). */
  notify(opts: NotifyOptions): Promise<void>;

  clipboard: ClipboardAPI;

  /** Open URL in user's default browser. Desktop: shell.openExternal.
   *  Web: window.open with rel=noreferrer. */
  openExternal(url: string): Promise<void>;

  /** Trigger a download. Web: anchor with download attr; Desktop: native
   *  save dialog + fs.writeFile. */
  downloadFile(blob: Blob, filename: string): Promise<void>;

  // ── Optional desktop-only capabilities ─────────────────────────────────
  bridge?: BridgeControlAPI;
  window?: WindowControlAPI;
  updates?: UpdateAPI;
}

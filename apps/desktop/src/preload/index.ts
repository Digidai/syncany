/**
 * Preload — exposes a narrow `window.raltic` API to the renderer for
 * the settings + tray-status flows. Keep this surface tight: every
 * function corresponds to ONE main-process IPC handler in main/index.ts
 * with input validation. Do NOT expose ipcRenderer or node:* directly.
 */
import { contextBridge, ipcRenderer } from "electron";

export interface DesktopConfig {
  apiKey?: string;
  serverUrl?: string;
}

const api = {
  getConfig: (): Promise<DesktopConfig> => ipcRenderer.invoke("config:get"),
  saveConfig: (cfg: DesktopConfig): Promise<{ ok: true; running: boolean }> =>
    ipcRenderer.invoke("config:save", cfg),
  bridgeStatus: (): Promise<{ running: boolean }> =>
    ipcRenderer.invoke("bridge:status"),
  checkForUpdates: (): Promise<{ ok: true }> =>
    ipcRenderer.invoke("updater:check"),
};

contextBridge.exposeInMainWorld("raltic", api);

// Useful for type-only consumers in the renderer.
export type RalticApi = typeof api;

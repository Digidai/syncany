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
  serverId?: string;
  keys?: Array<{
    apiKey: string;
    serverUrl?: string;
    serverId?: string;
    addedAt?: number;
  }>;
}

export interface DesktopBridgeConnectConfig {
  apiKey: string;
  serverUrl?: string;
  serverId: string;
}

export interface DesktopBridgeStatus {
  running: boolean;
  serverId: string | null;
  serverIds: string[];
  configuredServerIds: string[];
}

const api = {
  getConfig: (): Promise<DesktopConfig> => ipcRenderer.invoke("config:get"),
  saveConfig: (cfg: DesktopConfig): Promise<{ ok: true; running: boolean; serverId: string | null; serverIds: string[] }> =>
    ipcRenderer.invoke("config:save", cfg),
  connectBridge: (cfg: DesktopBridgeConnectConfig): Promise<{ ok: true; running: boolean; serverId: string | null; serverIds: string[] }> =>
    ipcRenderer.invoke("bridge:connect", cfg),
  bridgeStatus: (): Promise<DesktopBridgeStatus> =>
    ipcRenderer.invoke("bridge:status"),
  checkForUpdates: (): Promise<{ ok: true }> =>
    ipcRenderer.invoke("updater:check"),
};

contextBridge.exposeInMainWorld("raltic", api);

// Useful for type-only consumers in the renderer.
export type RalticApi = typeof api;

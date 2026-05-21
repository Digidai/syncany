import { contextBridge, ipcRenderer } from "electron";
const api = {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (cfg) => ipcRenderer.invoke("config:save", cfg),
  bridgeStatus: () => ipcRenderer.invoke("bridge:status"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check")
};
contextBridge.exposeInMainWorld("raltic", api);

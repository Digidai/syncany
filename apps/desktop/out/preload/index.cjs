"use strict";
const electron = require("electron");
const api = {
  getConfig: () => electron.ipcRenderer.invoke("config:get"),
  saveConfig: (cfg) => electron.ipcRenderer.invoke("config:save", cfg),
  connectBridge: (cfg) => electron.ipcRenderer.invoke("bridge:connect", cfg),
  bridgeStatus: () => electron.ipcRenderer.invoke("bridge:status"),
  checkForUpdates: () => electron.ipcRenderer.invoke("updater:check")
};
electron.contextBridge.exposeInMainWorld("raltic", api);

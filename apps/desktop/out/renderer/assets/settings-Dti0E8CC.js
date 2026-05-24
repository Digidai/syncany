const apiKeyEl = (
  /** @type {HTMLInputElement} */
  document.getElementById("apiKey")
);
const serverUrlEl = (
  /** @type {HTMLInputElement} */
  document.getElementById("serverUrl")
);
const statusEl = (
  /** @type {HTMLElement} */
  document.getElementById("status")
);
const saveBtn = (
  /** @type {HTMLButtonElement} */
  document.getElementById("save")
);
const updatesBtn = (
  /** @type {HTMLButtonElement} */
  document.getElementById("updates")
);
function setStatus(text, isErr) {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", !!isErr);
}
function bridgeStatusText(st, saved) {
  const serverIds = Array.isArray(st.serverIds) ? st.serverIds : st.serverId ? [st.serverId] : [];
  if (st.running) {
    if (serverIds.length > 1) return `Bridge is running for ${serverIds.length} workspaces.`;
    if (serverIds.length === 1) return `Bridge is running for workspace ${serverIds[0]}.`;
    return "Bridge is running.";
  }
  if (saved) return "Saved, but the bridge is idle. Check the key and try again.";
  return "Bridge is idle — add an API key to start.";
}
async function load() {
  try {
    const cfg = await window.raltic.getConfig();
    apiKeyEl.value = cfg.apiKey || "";
    serverUrlEl.value = cfg.serverUrl || "";
    const st = await window.raltic.bridgeStatus();
    setStatus(bridgeStatusText(st, false));
  } catch (e) {
    setStatus("Couldn't load config: " + (e && e.message ? e.message : e), true);
  }
}
saveBtn.addEventListener("click", async () => {
  saveBtn.disabled = true;
  setStatus("Saving + restarting bridge…");
  try {
    const r = await window.raltic.saveConfig({
      apiKey: apiKeyEl.value,
      serverUrl: serverUrlEl.value
    });
    setStatus(bridgeStatusText(r, true));
  } catch (e) {
    setStatus("Save failed: " + (e && e.message ? e.message : e), true);
  } finally {
    saveBtn.disabled = false;
  }
});
updatesBtn.addEventListener("click", async () => {
  updatesBtn.disabled = true;
  setStatus("Checking for updates…");
  try {
    await window.raltic.checkForUpdates();
    setStatus("Update check sent. If one's available you'll see a dialog.");
  } catch (e) {
    setStatus("Update check failed: " + (e && e.message ? e.message : e), true);
  } finally {
    updatesBtn.disabled = false;
  }
});
load();

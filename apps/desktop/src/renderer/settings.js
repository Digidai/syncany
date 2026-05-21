// Settings renderer logic. Extracted from inline <script> because
// settings.html's CSP (`script-src 'self'`) doesn't permit inline.
// Loaded via <script src="./settings.js"></script>.

const apiKeyEl = /** @type {HTMLInputElement} */ (document.getElementById("apiKey"));
const serverUrlEl = /** @type {HTMLInputElement} */ (document.getElementById("serverUrl"));
const statusEl = /** @type {HTMLElement} */ (document.getElementById("status"));
const saveBtn = /** @type {HTMLButtonElement} */ (document.getElementById("save"));
const updatesBtn = /** @type {HTMLButtonElement} */ (document.getElementById("updates"));

function setStatus(text, isErr) {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", !!isErr);
}

async function load() {
  try {
    const cfg = await window.raltic.getConfig();
    apiKeyEl.value = cfg.apiKey || "";
    serverUrlEl.value = cfg.serverUrl || "";
    const st = await window.raltic.bridgeStatus();
    setStatus(st.running ? "Bridge is running." : "Bridge is idle — add an API key to start.");
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
      serverUrl: serverUrlEl.value,
    });
    setStatus(r.running ? "Saved. Bridge running." : "Saved. Bridge idle (no API key).");
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

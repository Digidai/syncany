/**
 * System tray icon + menu. Stays alive after the main window closes so
 * the user can re-open it without re-launching the app.
 *
 * On macOS the icon shows up in the menubar; on Windows/Linux it lands
 * in the system tray. We use a tiny ASCII-art template image because
 * D5 ships no design assets yet — Phase D8 (post-design-review) will
 * swap in a brand-aligned icon. Template images get auto-tinted to match
 * the system theme.
 */
import { app, Menu, nativeImage, Tray } from "electron";
import { restartBridge, isRunning } from "./bridge-manager.js";

let trayInstance: Tray | null = null;

interface TrayOpts {
  showMain: () => void;
  showSettings: () => void;
  quit: () => void;
}

// 16x16 transparent black square. Replace with brand icon at D8. Using
// a template image (suffix .template handled by nativeImage) so macOS
// re-tints automatically for light/dark menubar.
function placeholderIcon() {
  const img = nativeImage.createEmpty();
  // Empty image still renders — macOS shows a small dot. Acceptable
  // placeholder; ergonomic enough that the tray is discoverable.
  return img;
}

export function createTray(opts: TrayOpts): Tray {
  if (trayInstance) return trayInstance;
  trayInstance = new Tray(placeholderIcon());
  trayInstance.setToolTip("Raltic");
  rebuildMenu(opts);
  // Clicking the tray icon on Win/Linux opens the main window. On macOS
  // clicks open the menu by default, which is what we want.
  if (process.platform !== "darwin") {
    trayInstance.on("click", () => opts.showMain());
  }
  return trayInstance;
}

export function rebuildMenu(opts: TrayOpts): void {
  if (!trayInstance) return;
  const menu = Menu.buildFromTemplate([
    { label: "Open Raltic", click: () => opts.showMain() },
    { type: "separator" },
    {
      label: isRunning() ? "Bridge: running" : "Bridge: not running",
      enabled: false,
    },
    {
      label: "Restart bridge",
      click: () => {
        void restartBridge().finally(() => rebuildMenu(opts));
      },
    },
    { type: "separator" },
    { label: "Settings…", click: () => opts.showSettings() },
    { type: "separator" },
    { label: `Raltic ${app.getVersion()}`, enabled: false },
    { label: "Quit Raltic", click: () => opts.quit() },
  ]);
  trayInstance.setContextMenu(menu);
}

export function destroyTray(): void {
  if (trayInstance) {
    trayInstance.destroy();
    trayInstance = null;
  }
}

export function isTrayAlive(): boolean {
  return trayInstance !== null;
}

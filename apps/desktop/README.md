# @raltic/desktop

Minimal Electron shell that:

1. Loads the desktop launch surface at `https://raltic.com/desktop/launch`
   (origin overridable with `RALTIC_WEB_URL`) in a single window.
2. Boots `@raltic/bridge-core` inside the main process so a separate
   `npx @raltic/bridge` terminal isn't required.

**Phases D5/D6/D7 landed**:
- D5: window + in-process bridge
- D6: persistent system tray, Settings window (`~/.raltic/desktop/config.json` editor), in-process IPC bridge
- D7: auto-update via `electron-updater` (no-op until signed releases are published — see `docs/DESKTOP_RELEASE.md`)

Code signing + notarization NOT yet configured — `pnpm release` refuses to publish without the signing env vars, so accidental unsigned releases can't ship. Run unsigned dev builds via `pnpm dev`.

## Develop

```bash
pnpm install
pnpm --filter @raltic/desktop dev      # hot-reload Electron + renderer
```

## Build

```bash
pnpm --filter @raltic/desktop build    # → apps/desktop/out/
```

## Configure the bridge

The intended product flow is:

1. Open the app.
2. Sign in on the desktop-aware login screen if no web session exists.
3. The desktop launch screen resolves the user's default/personal workspace.
4. Click **Connect this computer** to create a per-machine key, save it locally,
   and start the embedded bridge.
5. The app opens the workspace once the bridge is running. Users can also
   choose **Skip for now** when they only want cloud agents or human chat.

The desktop main process stores bridge config at `~/.raltic/desktop/config.json`:

```json
{
  "apiKey": "ck_…",
  "serverUrl": "https://api.raltic.com",
  "serverId": "srv_…"
}
```

Get a machine API key from `https://raltic.com/s/<slug>/settings` (Machine API keys section). Without a key the bridge stays idle — the UI still works for normal human chat.

Or open the **Settings** entry in the tray menu — the in-app form writes the file with `0600` perms and restarts the bridge.

The one-click desktop launch flow writes `serverId` so the app only treats a
running bridge as connected when it is scoped to the current workspace.

After `pnpm --filter @raltic/desktop build`, run `pnpm --filter
@raltic/desktop smoke:launch` to verify the bundled preload and restricted
`/desktop/launch` IPC path. For a packaged app, pass
`RALTIC_DESKTOP_APP=/path/to/Raltic.app/Contents/MacOS/Raltic`.

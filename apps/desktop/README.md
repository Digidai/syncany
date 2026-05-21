# @raltic/desktop

Minimal Electron shell that:

1. Loads `https://raltic.com` (overridable with `RALTIC_WEB_URL`) in a single window.
2. Boots `@raltic/bridge-core` inside the main process so a separate `npx @raltic/bridge` terminal isn't required.

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

The desktop main process looks for `~/.raltic/desktop/config.json`:

```json
{
  "apiKey": "ck_…",
  "serverUrl": "https://api.raltic.com"
}
```

Get a machine API key from `https://raltic.com/s/<slug>/settings` (Machine API keys section). Without a key the bridge stays idle — the UI still works for normal human chat.

Or open the **Settings** entry in the tray menu — the in-app form writes the file with `0600` perms and restarts the bridge.

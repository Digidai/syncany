# Desktop release runbook

How to cut a Raltic desktop release that the auto-updater picks up.

## Prerequisites (one-time)

- **macOS code signing** — Apple Developer Program membership ($99/yr). Generate a "Developer ID Application" cert in Apple Developer → Certificates. Export to `.p12` + password.
- **macOS notarization** — App-specific password (or App Store Connect API key). The `notarytool` flow needs both Apple ID + team ID.
- **Windows code signing** — code-signing cert from DigiCert / Sectigo / etc. EV certs avoid SmartScreen warnings; OV gets you signed but flagged for ~30 days.
- **GitHub Releases publish token** — `GH_TOKEN` env var with `repo` scope on `Digidai/raltic` for electron-builder's publish step.

## Release a new version

```bash
cd apps/desktop

# 1. Bump version. Use semver — patch for bug fixes, minor for features,
#    major for breaking changes. electron-updater compares semver to decide
#    whether to prompt.
npm version patch         # → 0.0.2

# 2. Build + sign + notarize + upload to GitHub Releases.
#    Requires env vars (set in your shell, NOT committed):
#      CSC_LINK=path/to/AppleDeveloperID.p12
#      CSC_KEY_PASSWORD=<cert password>
#      APPLE_ID=<your-apple-id>
#      APPLE_APP_SPECIFIC_PASSWORD=<app-specific-pw>
#      APPLE_TEAM_ID=<10-char team id>
#      WIN_CSC_LINK=path/to/codesign.p12          # Windows only
#      WIN_CSC_KEY_PASSWORD=<win cert pw>
#      GH_TOKEN=<github-token-with-repo-scope>
pnpm --filter @raltic/desktop build
pnpm --filter @raltic/desktop smoke:launch
cd apps/desktop && npx electron-builder --publish always
```

For local packaged QA before a real publish:

```bash
cd apps/desktop
npx electron-builder --dir --publish never
RALTIC_DESKTOP_APP=release/mac-arm64/Raltic.app/Contents/MacOS/Raltic pnpm --filter @raltic/desktop smoke:launch
```

That produces `release/Raltic-0.0.2.dmg`, `Raltic Setup 0.0.2.exe`,
`Raltic-0.0.2.AppImage`, and the `latest*.yml` manifests. All are
uploaded to a GitHub Release named `v0.0.2`.

## What the user sees

1. The app opens `https://raltic.com/desktop/launch`, not the public marketing
   homepage. Unauthenticated users are sent through the desktop-aware login
   screen and then back to the launch surface.
2. The launch surface lets them connect the current computer by creating a
   per-machine key and starting the embedded bridge, or skip into the workspace
   when they only need cloud agents / normal chat.
3. Their already-running desktop app pings GitHub on next 6h tick (or on
   manual "Check for updates" from Settings).
4. Sees an "Update available — Raltic 0.0.2" dialog with Download / Later.
5. Picks Download → download runs in background.
6. Update applies on next app quit (auto-install on quit is enabled).

## Skipping a release for everyone

If a release was bad, **don't** delete the GitHub Release — electron-updater
caches `latest.yml` and could re-prompt. Instead:

1. Cut a new patch version with the fix.
2. Promote it normally.
3. Optionally publish a hotfix-only patch with a comment in the Release
   notes that the prior version is buggy.

## Verifying the update channel

Before publishing, verify the installed-client flow against a real account:

1. Open the built app and confirm the first page is `/desktop/launch`, not the
   public homepage.
2. Sign in from the desktop-aware login screen and return to `/desktop/launch`.
3. Click **Connect this computer** and confirm `~/.raltic/desktop/config.json`
   is `0600`, contains `apiKey`, `serverUrl`, and the target `serverId`, and
   does not expose the key anywhere in the web UI.
4. Confirm the app opens `/s/<slug>` and the workspace shows the local bridge
   online for that workspace.
5. From any non-`/desktop/launch` page, confirm desktop bridge connection IPC is
   not callable. The automated `smoke:launch` script covers this for the built
   preload.

```bash
# What the updater fetches:
curl -fsS https://github.com/Digidai/raltic/releases/latest/download/latest-mac.yml
```

The YAML should list the current version + SHA-512 of the .dmg/.zip.
electron-updater refuses to install if SHA doesn't match.

## Unsigned dev builds

`pnpm --filter @raltic/desktop build` produces unsigned artifacts in
`release/`. Don't ship these to real users — macOS Gatekeeper will block
them, and even with Right-Click → Open the experience is hostile. Use
unsigned only for local QA.

## When auto-update is a no-op

The updater is disabled in dev (`app.isPackaged === false`) and in any
unsigned packaged build that fails signature verification on the
downloaded artifact. Failures fail-soft — logged via `[updater]` prefix,
never crashing the app.

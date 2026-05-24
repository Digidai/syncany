# Desktop internal QA runbook

Use this while Raltic Desktop is in internal testing and we do not have Apple
Developer ID / Windows code-signing certificates yet.

## Status

- Internal testers only.
- Publish only as a GitHub pre-release with beta wording.
- Link only through the `/desktop` beta page, not as a primary public download.
- Auto-update is not part of the unsigned QA flow.
- macOS Gatekeeper and Windows SmartScreen warnings are expected.

The production release path remains `pnpm --filter @raltic/desktop release`.
That command refuses to publish without signing and notarization credentials.

## Build a local QA app

```bash
pnpm install
pnpm --filter @raltic/desktop package
pnpm --filter @raltic/desktop smoke:launch
```

`package` creates an unpacked local app in `apps/desktop/release/` and the
smoke test opens that packaged app when it is present.

On macOS Apple Silicon, the smoke target is usually:

```bash
apps/desktop/release/mac-arm64/Raltic.app/Contents/MacOS/Raltic
```

## Build shareable QA artifacts

```bash
pnpm --filter @raltic/desktop package:qa
```

This creates host-specific unsigned artifacts in `apps/desktop/release/`.
Examples:

- macOS: `.dmg` / `.zip`
- Windows: `.exe`
- Linux: `.AppImage`

Distribute these only to named internal testers, either through the GitHub
pre-release below or through a direct internal channel.

## GitHub pre-release

When a beta needs a stable download URL, create a pre-release instead of a
normal release:

```bash
gh release create desktop-v0.0.1-beta.1 \
  apps/desktop/release/Raltic-0.0.1-arm64.dmg \
  apps/desktop/release/Raltic-0.0.1-arm64-mac.zip \
  apps/desktop/release/Raltic-0.0.1.dmg \
  apps/desktop/release/Raltic-0.0.1-mac.zip \
  --repo Digidai/raltic \
  --prerelease \
  --title "Raltic Desktop 0.0.1 beta 1"
```

Do not upload `latest-mac.yml` for unsigned beta releases. Internal beta
updates are manual downloads from GitHub Releases; the automatic update channel
is reserved for signed + notarized builds.

## macOS tester instructions

Unsigned builds may show "unidentified developer", "cannot be opened", or
"damaged" warnings. For internal QA only:

1. Download the QA artifact from the GitHub pre-release or private internal channel.
2. Move `Raltic.app` to `/Applications`.
3. Right-click `Raltic.app` and choose **Open**.
4. If macOS still blocks it, remove quarantine:

```bash
xattr -dr com.apple.quarantine /Applications/Raltic.app
```

Then open the app again.

## Functional QA checklist

1. App opens `https://raltic.com/desktop/launch`, not the marketing homepage.
2. Unauthenticated users land on the desktop-aware login screen.
3. After login, `/desktop/launch` shows the personal workspace as the target.
4. **Connect this computer** creates a machine key and starts the embedded bridge.
5. `~/.raltic/desktop/config.json` exists and is not group/world readable.
6. The workspace opens and shows the local bridge as online for that workspace.
7. Closing the main window keeps the app alive in the tray/menu bar.
8. Tray **Restart bridge** restarts without requiring app relaunch.
9. Settings can save a replacement key and restart the bridge.
10. A second workspace can be connected without replacing the first workspace key.

## When to move beyond internal QA

Do not publish a stable GitHub Release or primary public download page until:

- macOS Developer ID signing is configured.
- macOS notarization is configured.
- Windows signing is configured or Windows is intentionally excluded.
- A signed update flow has been tested from one installed version to the next.

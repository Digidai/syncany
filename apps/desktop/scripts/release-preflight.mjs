#!/usr/bin/env node
/**
 * Release preflight — refuses to invoke `electron-builder --publish` if
 * the env required to produce a signed + notarized artifact is missing.
 *
 * The alternative (current default of `--publish always`) silently ships
 * unsigned binaries to GitHub Releases, which:
 *   1. macOS Gatekeeper blocks for direct downloads.
 *   2. electron-updater on existing installs REJECTS at signature
 *      verification → effectively breaks auto-update.
 *
 * Cross-platform rule:
 *   - When publishing for macOS targets, require CSC_LINK +
 *     CSC_KEY_PASSWORD, plus either Apple ID notarization env OR
 *     App Store Connect API key notarization env.
 *   - When publishing for Windows targets, require WIN_CSC_LINK +
 *     WIN_CSC_KEY_PASSWORD.
 *   - GH_TOKEN always required to upload.
 */
const errors = [];

if (!process.env.GH_TOKEN) {
  errors.push("GH_TOKEN is required to upload to GitHub Releases");
}

// Detect which platforms we're publishing for. electron-builder
// reads --mac/--win/--linux flags from argv; if none provided it
// builds for the current host. Keep this simple: warn for every
// platform whose signing env is missing.
const argv = process.argv.slice(2);
const isHostMac = process.platform === "darwin";
const isHostWin = process.platform === "win32";
const wantMac = argv.includes("--mac") || (argv.length === 0 && isHostMac);
const wantWin = argv.includes("--win") || (argv.length === 0 && isHostWin);

function hasAll(vars) {
  return vars.every((v) => !!process.env[v]);
}

if (wantMac) {
  const signingVars = ["CSC_LINK", "CSC_KEY_PASSWORD"];
  const appleIdVars = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
  const appleApiKeyVars = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
  for (const v of signingVars) {
    if (!process.env[v]) errors.push(`macOS publish requires ${v}`);
  }
  if (!hasAll(appleIdVars) && !hasAll(appleApiKeyVars)) {
    errors.push(
      "macOS notarization requires either APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID " +
      "or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER",
    );
  }
}

if (wantWin) {
  const winVars = ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"];
  for (const v of winVars) {
    if (!process.env[v]) errors.push(`Windows publish requires ${v}`);
  }
}

if (errors.length > 0) {
  console.error("[release-preflight] refusing to publish without signing config:");
  for (const e of errors) console.error("  - " + e);
  console.error("\nSee docs/DESKTOP_RELEASE.md for the full env list.");
  if (process.env.RALTIC_ALLOW_UNSIGNED === "1") {
    console.error("RALTIC_ALLOW_UNSIGNED is intentionally ignored for publish. Use `pnpm --filter @raltic/desktop package` for unsigned QA.");
  }
  process.exit(1);
}

console.log("[release-preflight] signing config present, proceeding to electron-builder");

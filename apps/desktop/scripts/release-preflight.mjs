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
 *     CSC_KEY_PASSWORD + APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD +
 *     APPLE_TEAM_ID.
 *   - When publishing for Windows targets, require WIN_CSC_LINK +
 *     WIN_CSC_KEY_PASSWORD.
 *   - GH_TOKEN always required to upload.
 *
 * Override with RALTIC_ALLOW_UNSIGNED=1 for QA dry-runs (still won't
 * notarize; documents the explicit override in CI logs).
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

if (wantMac) {
  const macVars = [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ];
  for (const v of macVars) {
    if (!process.env[v]) errors.push(`macOS publish requires ${v}`);
  }
}

if (wantWin) {
  const winVars = ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"];
  for (const v of winVars) {
    if (!process.env[v]) errors.push(`Windows publish requires ${v}`);
  }
}

if (errors.length > 0) {
  if (process.env.RALTIC_ALLOW_UNSIGNED === "1") {
    console.warn("[release-preflight] missing signing env, but RALTIC_ALLOW_UNSIGNED=1 — continuing:");
    for (const e of errors) console.warn("  - " + e);
    process.exit(0);
  }
  console.error("[release-preflight] refusing to publish without signing config:");
  for (const e of errors) console.error("  - " + e);
  console.error("\nSee docs/DESKTOP_RELEASE.md for the full env list.");
  console.error("Set RALTIC_ALLOW_UNSIGNED=1 to override (QA only — DO NOT use for end-user releases).");
  process.exit(1);
}

console.log("[release-preflight] signing config present, proceeding to electron-builder");

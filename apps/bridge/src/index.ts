// shebang is injected by build.mjs (banner) — keeping it here would duplicate.
import { Bridge } from "@raltic/bridge-core";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

export interface CliArgs {
  serverUrl: string;
  /**
   * One or more machine API keys. A single bridge process can serve N
   * workspaces in parallel — one Bridge instance per key. Sources, in
   * priority order: repeated `--api-key` CLI flag, positional `ck_…`
   * tokens, `RALTIC_API_KEYS` (comma-separated env), `RALTIC_API_KEY`
   * (single env, back-compat), and finally `~/.raltic/config.json`'s
   * `keys` array. Deduped + order-preserved across sources.
   */
  apiKeys: string[];
  agentsDir: string;
}

/**
 * Parse CLI arguments into a multi-key shape.
 *
 * Input shapes (priority high → low):
 *   1. Repeated `--api-key ck_a --api-key ck_b ...` OR `--api-key=ck_…`.
 *   2. Positional `ck_…` tokens (any non-flag arg starting with `ck_`).
 *   3. `RALTIC_API_KEYS=ck_a,ck_b` comma-separated env.
 *   4. `RALTIC_API_KEY=ck_x` single env (back-compat).
 *   5. `~/.raltic/config.json` → { keys: ["ck_x", "ck_y"] }.
 *
 * Why multi-key:
 *   machine_keys are per-workspace (apps/api/src/routes/bridge.ts:58)
 *   for security — a leaked key only exposes one workspace. But a user
 *   invited to N workspaces who owns agents in several of them needs
 *   the bridge to serve all of them. Pre-multi-key the only workaround
 *   was running multiple bridge processes, which is awkward UX. Now one
 *   `npx -y @raltic/bridge ck_a ck_b ck_c` covers it.
 *
 * Dedup: identical key strings collapse to one (prevents two Bridge
 * instances accidentally fighting for the same WS lease).
 *
 * Exported for unit tests; production main() consumes it as before.
 */
export function parseArgs(argv: string[], envOverride?: NodeJS.ProcessEnv): CliArgs {
  const env = envOverride ?? process.env;
  const apiKeysFromCli: string[] = [];
  let serverUrl: string | undefined;
  let agentsDir: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    let key = raw;
    let val: string | undefined;
    const eq = raw.indexOf("=");
    if (raw.startsWith("--") && eq > 0) {
      key = raw.slice(0, eq);
      val = raw.slice(eq + 1);
    } else if (raw.startsWith("--")) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { val = next; i++; }
    } else if (raw.startsWith("ck_")) {
      // Positional API key — accumulate so `npx pkg ck_a ck_b` works.
      apiKeysFromCli.push(raw);
      continue;
    }
    if (val === undefined) continue;
    if (key === "--server-url") serverUrl = val;
    else if (key === "--api-key") apiKeysFromCli.push(val);
    else if (key === "--agents-dir") agentsDir = val;
  }

  // Compose final keys: CLI > env-comma > env-single > config-file.
  const seen = new Set<string>();
  const apiKeys: string[] = [];
  const add = (k: string) => {
    const trimmed = k.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed); apiKeys.push(trimmed);
  };
  for (const k of apiKeysFromCli) add(k);
  if (env.RALTIC_API_KEYS) {
    for (const k of env.RALTIC_API_KEYS.split(",")) add(k);
  }
  if (env.RALTIC_API_KEY) add(env.RALTIC_API_KEY);
  // Config file last — explicit args override stored config.
  try {
    const cfgPath = join(homedir(), ".raltic", "config.json");
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf-8")) as { keys?: Array<string | { apiKey?: string }> };
      if (Array.isArray(cfg.keys)) {
        for (const entry of cfg.keys) {
          if (typeof entry === "string") add(entry);
          else if (entry && typeof entry === "object" && entry.apiKey) add(entry.apiKey);
        }
      }
    }
  } catch (e) {
    // Config malformed — log once, fall through.
    console.warn(`[bridge] couldn't read ~/.raltic/config.json: ${e instanceof Error ? e.message : e}`);
  }

  return {
    serverUrl: serverUrl ?? env.RALTIC_SERVER_URL ?? "https://api.raltic.com",
    apiKeys,
    agentsDir: agentsDir ?? env.RALTIC_AGENTS_DIR ?? join(homedir(), ".raltic", "agents"),
  };
}

/**
 * keyPrefix(key) — derive a short, filesystem-safe identifier from an
 * API key for namespacing agent-work directories. ck_xxxxxx with the
 * first 10 chars after the `ck_` prefix is unique enough across keys a
 * single user holds (key IDs are random UUIDs) without exposing the
 * full secret in directory listings.
 */
function keyPrefix(apiKey: string): string {
  return apiKey.slice(0, 12).replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Persist an API key to `~/.raltic/config.json` so future invocations
 * of `raltic-bridge` (no args) pick it up automatically. Merges with
 * any existing keys — never clobbers — so `setup` can be re-run with a
 * second key to add a second workspace.
 *
 * Atomic write via tempfile-rename so a crashed `setup` mid-write
 * doesn't corrupt the config (read-side surface in parseArgs already
 * tolerates malformed JSON with a warning, but better not to break the
 * file in the first place).
 */
async function persistKeyToConfig(apiKey: string): Promise<void> {
  const { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } = await import("fs");
  const cfgDir = join(homedir(), ".raltic");
  const cfgPath = join(cfgDir, "config.json");
  if (!existsSync(cfgDir)) mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
  let cfg: { keys?: Array<{ apiKey: string; addedAt: number }> } = {};
  if (existsSync(cfgPath)) {
    try { cfg = JSON.parse(readFileSync(cfgPath, "utf-8")); }
    catch { /* corrupt file — overwrite */ }
  }
  cfg.keys = cfg.keys ?? [];
  if (!cfg.keys.some((e) => e.apiKey === apiKey)) {
    cfg.keys.push({ apiKey, addedAt: Date.now() });
  }
  const tmp = `${cfgPath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  renameSync(tmp, cfgPath);
}

async function main(): Promise<void> {
  // `raltic setup [ck_xxx]` subcommand — persists the key to
  // ~/.raltic/config.json so subsequent `raltic` invocations don't
  // need it on the CLI, then drops into the normal bridge run loop.
  // This is the multica-inspired "one command from zero to ready"
  // path: copy-paste `npx -y @raltic/bridge setup ck_xxx`, get a
  // running bridge plus a saved config for future runs.
  //
  // Why a subcommand instead of just "first run writes config":
  //   - Explicit intent — users running `--api-key ck_xxx` ad hoc
  //     (e.g. CI scripts) don't want their key persisted to disk.
  //   - Discoverable in `--help` output.
  if (process.argv[2] === "setup") {
    const positional = process.argv.slice(3).find((a) => a.startsWith("ck_"));
    if (!positional) {
      console.error("Usage: raltic-bridge setup ck_xxx");
      console.error("");
      console.error("Persists the key to ~/.raltic/config.json so future runs of");
      console.error("`raltic-bridge` (no args) automatically connect.");
      process.exit(1);
    }
    await persistKeyToConfig(positional);
    console.log(`[setup] saved key ${keyPrefix(positional)} to ~/.raltic/config.json`);
    console.log(`[setup] starting bridge…`);
    // Fall through to the normal run loop using the now-persisted key.
  }

  const args = parseArgs(process.argv.filter((a) => a !== "setup"));
  if (args.apiKeys.length === 0) {
    console.error("Missing API key.");
    console.error("Get one from your workspace's Settings → Machine API keys page,");
    console.error("e.g. https://raltic.com/s/<your-slug>/settings");
    console.error("");
    console.error("Usage:");
    console.error("  npx -y @raltic/bridge ck_…              # single key");
    console.error("  npx -y @raltic/bridge ck_a ck_b ck_c     # multiple workspaces");
    console.error("  RALTIC_API_KEYS=ck_a,ck_b npx -y @raltic/bridge");
    process.exit(1);
  }

  console.log(`[bridge] starting`);
  console.log(`[bridge]   server-url=${args.serverUrl}`);
  console.log(`[bridge]   agents-dir=${args.agentsDir}`);
  console.log(`[bridge]   keys: ${args.apiKeys.length} (${args.apiKeys.map(keyPrefix).join(", ")})`);

  // Spawn one Bridge per key. Agent working dirs are scoped per-key so
  // Claude Code session-id files for the same agent-name in different
  // workspaces don't clobber each other.
  const bridges: Array<{ key: string; bridge: Bridge; started: boolean }> = args.apiKeys.map((key) => ({
    key,
    bridge: new Bridge({
      serverUrl: args.serverUrl,
      apiKey: key,
      agentsDir: join(args.agentsDir, keyPrefix(key)),
    }),
    started: false,
  }));

  const onStop = async () => {
    console.log(`[bridge] shutting down ${bridges.length} bridge(s)`);
    await Promise.all(bridges.map(async (b) => {
      if (b.started) {
        try { await b.bridge.stop(); }
        catch (e) { console.warn(`[bridge:${keyPrefix(b.key)}] stop error:`, e); }
      }
    }));
    process.exit(0);
  };
  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);

  // Start each bridge in parallel. Failure-isolation: a bad/revoked
  // key shouldn't prevent the other workspaces from coming online.
  // We require AT LEAST ONE bridge to succeed; if all fail, exit 1.
  const results = await Promise.all(bridges.map(async (b) => {
    try {
      await b.bridge.start();
      b.started = true;
      console.log(`[bridge:${keyPrefix(b.key)}] ready — waiting for messages`);
      return true;
    } catch (e) {
      console.error(`[bridge:${keyPrefix(b.key)}] start failed:`, e instanceof Error ? e.message : e);
      return false;
    }
  }));
  if (!results.some((ok) => ok)) {
    console.error(`[bridge] all ${bridges.length} bridge(s) failed to start — exiting`);
    process.exit(1);
  }
  if (results.some((ok) => !ok)) {
    const failed = results.filter((ok) => !ok).length;
    console.warn(`[bridge] ${failed}/${bridges.length} bridge(s) failed to start; remaining keys keep running`);
  }
}

// Only run main() when executed directly (e.g. `node dist/index.js` or
// `npx -y @raltic/bridge`). Skip when this module is imported by tests
// or by another wrapper — otherwise importing parseArgs from a test
// triggers main() → process.exit(1).
//
// Detection: import.meta.url matches the process's first argv entry
// (with file:// URL normalization). Falls back to running if either is
// unavailable so the production path stays robust.
const invokedAsScript = (() => {
  if (typeof process === "undefined" || !process.argv?.[1]) return false;
  try {
    const argvUrl = new URL(`file://${process.argv[1]}`).href;
    return import.meta.url === argvUrl;
  } catch { return false; }
})();
if (invokedAsScript) {
  main();
}

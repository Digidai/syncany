// shebang is injected by build.mjs (banner) — keeping it here would duplicate.
import { Bridge } from "./bridge.js";
import { homedir } from "os";
import { join } from "path";

interface CliArgs {
  serverUrl: string;
  apiKey: string;
  agentsDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  // Accept both `--flag value` and `--flag=value`.
  const args: Partial<CliArgs> = {};
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
    }
    if (val === undefined) continue;
    if (key === "--server-url") args.serverUrl = val;
    else if (key === "--api-key") args.apiKey = val;
    else if (key === "--agents-dir") args.agentsDir = val;
  }
  return {
    serverUrl: args.serverUrl
      ?? process.env.SYNCANY_SERVER_URL
      ?? "https://syncany-api.genedai.workers.dev",
    apiKey: args.apiKey ?? process.env.SYNCANY_API_KEY ?? "",
    agentsDir: args.agentsDir ?? process.env.SYNCANY_AGENTS_DIR ?? join(homedir(), ".syncany", "agents"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (!args.apiKey) {
    console.error("Missing --api-key (or SYNCANY_API_KEY env).");
    console.error("Get one from your workspace's Settings → Machine API keys page,");
    console.error("e.g. https://syncany-web.genedai.workers.dev/s/<your-slug>/settings");
    console.error("");
    console.error("Usage:");
    console.error("  npx -y @syncany/bridge --api-key ck_…");
    console.error("  npx -y @syncany/bridge --api-key=ck_…");
    process.exit(1);
  }

  console.log(`[bridge] starting`);
  console.log(`[bridge]   server-url=${args.serverUrl}`);
  console.log(`[bridge]   agents-dir=${args.agentsDir}`);

  const bridge = new Bridge({
    serverUrl: args.serverUrl,
    apiKey: args.apiKey,
    agentsDir: args.agentsDir,
  });

  const onStop = async () => {
    console.log(`[bridge] shutting down`);
    await bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);

  try {
    await bridge.start();
    console.log(`[bridge] ready — waiting for messages`);
  } catch (e) {
    console.error(`[bridge] start failed:`, e);
    process.exit(1);
  }
}

main();

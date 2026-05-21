#!/usr/bin/env node
// esbuild via JS API so the banner gets a real newline (the inline
// --banner='...\n...' form in package.json shipped a literal backslash-n
// in 0.1.5 → broke `npx` end-users with a SyntaxError).
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  // Just the shebang. createRequire is imported by the bundled agent-manager
  // module already (used to resolve @raltic/cli at runtime).
  banner: { js: "#!/usr/bin/env node" },
  external: [
    // Bridge spawns 'claude' as a child process, never imports it.
    "claude",
    // @openai/codex-sdk is large + ships its own bundled binaries; let
    // npm/npx resolve it from node_modules at runtime instead of
    // bundling. Listed as a real `dependencies` entry so it installs
    // alongside the bridge.
    "@openai/codex-sdk",
  ],
});
console.log("✓ bridge bundle written to dist/index.js");

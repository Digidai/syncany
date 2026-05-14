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
  // module already (used to resolve @digidai/syncany-cli at runtime).
  banner: { js: "#!/usr/bin/env node" },
  // Don't bundle 'claude' — bridge calls it via child_process.spawn.
  external: ["claude"],
});
console.log("✓ bridge bundle written to dist/index.js");

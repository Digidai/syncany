import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * electron-vite config — three rollup outputs (main, preload, renderer)
 * built in parallel.
 *
 * We deliberately DO NOT use externalizeDepsPlugin for the main bundle:
 * `@raltic/bridge-core` and its workspace siblings (`@raltic/protocol`,
 * `@raltic/agent-runtime`) ship as TypeScript source from their pnpm
 * symlinks, which Electron's Node runtime can't import directly. Letting
 * Vite bundle them inline mirrors how `apps/bridge/build.mjs` bundles
 * them for the npx CLI. `@openai/codex-sdk` ships its own native binaries
 * so we keep it external.
 *
 * The renderer is a placeholder — the main process loads raltic.com
 * directly. The renderer dir still exists so when we later embed
 * @raltic/ui directly there's a place for it without restructuring.
 */
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
        external: ["electron", "@openai/codex-sdk"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, "src/preload/index.ts") },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      // Multi-entry: index.html is the placeholder for the main window
      // (which actually loads raltic.com), settings.html is the standalone
      // settings UI loaded into its own BrowserWindow.
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          settings: resolve(__dirname, "src/renderer/settings.html"),
        },
      },
    },
  },
});

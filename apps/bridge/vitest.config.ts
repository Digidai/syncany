// Plain Node vitest config — parseArgs is pure JS, no worker pool needed.
// Bridge's runtime tests (Bridge class WS lifecycle, agent dispatch, etc.)
// live in @raltic/bridge-core and run there. This config only covers the
// CLI surface in src/index.ts and src/cli/.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});

import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        singleWorker: true,
        // Disable per-suite storage isolation — we coordinate state manually
        // via per-test channel ids and DB seeding, and the snapshot/restore
        // hits a known SQLite WAL issue: https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#isolated-storage
        isolatedStorage: false,
        wrangler: { configPath: "./wrangler.test.toml" },
      },
    },
  },
});

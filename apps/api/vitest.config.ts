import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        singleWorker: true,
        // Each test is responsible for seeding its own data and using
        // unique ids so they don't collide. Per-test storage isolation
        // hits a SQLite WAL bug per the chat-room package's note —
        // same workaround applies here.
        isolatedStorage: false,
        wrangler: { configPath: "./wrangler.test.toml" },
        miniflare: {
          // Apply the live D1 migrations on every test boot so the in-memory
          // SQLite matches production schema exactly. Without this, drizzle
          // queries fail at runtime against an empty DB.
          // (The actual migration application happens in test/setup.ts; this
          //  just ensures the DB binding exists.)
          compatibilityFlags: ["nodejs_compat"],
        },
      },
    },
    setupFiles: ["./test/setup.ts"],
  },
});

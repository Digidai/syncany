/**
 * Vitest setup file — runs once per worker boot.
 *
 * Applies every D1 migration to the in-memory test DB so drizzle queries
 * see the same schema as production.
 *
 * Why we don't use `applyD1Migrations`:
 *   The Cloudflare-recommended path is `applyD1Migrations(env.DB,
 *   env.TEST_MIGRATIONS)`, which expects vitest-pool-workers to inject
 *   `TEST_MIGRATIONS` from the `migrations_dir` setting. As of
 *   @cloudflare/vitest-pool-workers shipped in this monorepo,
 *   `TEST_MIGRATIONS` arrives as `undefined`, so that path silently
 *   leaves the DB empty and every later `seedUser` blows up with
 *   "no such table: user". Importing the SQL files directly via Vite's
 *   `?raw` query embeds them in the worker bundle (fs is sandboxed
 *   inside the test runtime), then we split on Drizzle's per-statement
 *   sentinel and exec each statement. Same approach as
 *   `packages/chat-room/test/setup.ts`. Add a new import line below
 *   whenever a new migration file lands.
 */
import { env } from "cloudflare:test";
import { beforeAll } from "vitest";

import migration0 from "../../../packages/db/migrations/0000_initial.sql?raw";
import migration1 from "../../../packages/db/migrations/0001_add_reactions_unread_edits.sql?raw";
import migration2 from "../../../packages/db/migrations/0002_add_invites.sql?raw";
import migration3 from "../../../packages/db/migrations/0003_quick_plazm.sql?raw";
import migration4 from "../../../packages/db/migrations/0004_great_rattler.sql?raw";
import migration5 from "../../../packages/db/migrations/0005_stale_beyonder.sql?raw";
import migration6 from "../../../packages/db/migrations/0006_easy_lady_bullseye.sql?raw";
import migration7 from "../../../packages/db/migrations/0007_task_inbox_index.sql?raw";
import migration8 from "../../../packages/db/migrations/0008_default_server.sql?raw";
import migration9 from "../../../packages/db/migrations/0009_servers_seeded.sql?raw";
import migration10 from "../../../packages/db/migrations/0010_friendly_mac_gargan.sql?raw";

const ALL_MIGRATIONS = [
  migration0, migration1, migration2, migration3, migration4,
  migration5, migration6, migration7, migration8, migration9,
  migration10,
].join("\n");

beforeAll(async () => {
  // Strip SQL line comments FIRST so the chunk-level filter below
  // doesn't drop a real statement just because its file starts with a
  // header comment (0008's comment block lives ABOVE the ALTER TABLE
  // — earlier version of this splitter discarded the whole chunk).
  const cleaned = ALL_MIGRATIONS
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");

  // Drizzle uses `-->\s*statement-breakpoint` between statements in
  // generated migrations; hand-written ones (0007, 0008) just use `;`
  // terminators. Split on both, then filter empties.
  const split = cleaned
    .split(/-->\s*statement-breakpoint/)
    .flatMap((chunk) => chunk.split(/;\s*(?:\n|$)/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of split) {
    try {
      // db.exec is single-statement; collapse internal newlines first.
      await env.DB.exec(stmt.replace(/\n+/g, " "));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Idempotency: vitest-pool-workers runs beforeAll per test FILE
      // but the DB binding persists across files when isolatedStorage
      // is false. Re-applying migrations against a populated DB throws
      // "already exists" / "duplicate column" — we treat those as
      // harmless. Real ordering bugs (no such table) still bubble up.
      if (/already exists|duplicate column/i.test(msg)) continue;
      throw new Error(`[test setup] migration statement failed: ${msg}\nstmt: ${stmt.slice(0, 200)}`);
    }
  }
});

declare module "cloudflare:test" {
  // Type the bindings so tests don't need `(env as any)`.
  interface ProvidedEnv {
    DB: D1Database;
    RATE_LIMITS: KVNamespace;
    UPLOADS: R2Bucket;
    BACKUPS: R2Bucket;
    CHAT_ROOM: DurableObjectNamespace;
    USER_GATEWAY: DurableObjectNamespace;
    WEB_ORIGIN: string;
    GOOGLE_CLIENT_ID: string;
    CF_ACCOUNT_ID: string;
    D1_DATABASE_ID: string;
    BETTER_AUTH_SECRET: string;
    CHAT_ROOM_AUTH_SECRET: string;
    MACHINE_KEY_PEPPER: string;
  }
}

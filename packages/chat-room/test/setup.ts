// Schema/migration application + parent-row seeding for tests.
// Migrations are imported as raw text via vite's `?raw` query so they're
// embedded into the worker bundle (fs is sandboxed inside the test runtime).
// Add new migration files here as they land — without all of them the
// drizzle-generated INSERTs will reference columns the test DB doesn't
// have (codex Final review: alarm flush test was failing because
// `messages.vector_indexed_at` was in the ORM model but missing from
// the test schema).
import migration0  from "../../db/migrations/0000_initial.sql?raw";
import migration1  from "../../db/migrations/0001_add_reactions_unread_edits.sql?raw";
import migration2  from "../../db/migrations/0002_add_invites.sql?raw";
import migration3  from "../../db/migrations/0003_quick_plazm.sql?raw";
import migration4  from "../../db/migrations/0004_great_rattler.sql?raw";
import migration5  from "../../db/migrations/0005_stale_beyonder.sql?raw";
import migration6  from "../../db/migrations/0006_easy_lady_bullseye.sql?raw";
import migration7  from "../../db/migrations/0007_task_inbox_index.sql?raw";
import migration8  from "../../db/migrations/0008_default_server.sql?raw";
import migration9  from "../../db/migrations/0009_servers_seeded.sql?raw";
import migration10 from "../../db/migrations/0010_friendly_mac_gargan.sql?raw";
import migration11 from "../../db/migrations/0011_greedy_night_thrasher.sql?raw";
import migration12 from "../../db/migrations/0012_keen_iron_fist.sql?raw";
import migration13 from "../../db/migrations/0013_polite_charles_xavier.sql?raw";
import migration14 from "../../db/migrations/0014_connector_constraints.sql?raw";
import migration15 from "../../db/migrations/0015_invite_email_binding.sql?raw";
import migration16 from "../../db/migrations/0016_peaceful_sway.sql?raw";
import migration17 from "../../db/migrations/0017_aromatic_baron_zemo.sql?raw";
import migration18 from "../../db/migrations/0018_motionless_kree.sql?raw";
import migration19 from "../../db/migrations/0019_sloppy_wolf_cub.sql?raw";
import migration20 from "../../db/migrations/0020_daily_lady_mastermind.sql?raw";

const MIGRATIONS = [
  migration0, migration1, migration2, migration3, migration4,
  migration5, migration6, migration7, migration8, migration9,
  migration10, migration11, migration12, migration13, migration14,
  migration15, migration16, migration17, migration18, migration19,
  migration20,
];

export async function applySchema(db: D1Database): Promise<void> {
  for (const m of MIGRATIONS) {
    // Strip line + block comments first, then split. Some migrations
    // (hand-written 0007/0008/0010) have no `--> statement-breakpoint`
    // markers and rely on bare semicolons; comment-stripping makes that
    // safe (no statement contains string literals with embedded `;`).
    const noComments = m
      .replace(/\/\*[\s\S]*?\*\//g, "")     // block comments
      .replace(/--[^\n]*/g, "");             // line comments
    const fragments = noComments.includes("--> statement-breakpoint")
      ? noComments.split("--> statement-breakpoint")
      : noComments.split(";");
    const statements = fragments
      .map(s => s.replace(/\s+/g, " ").trim())
      .filter(s => s.length > 0);
    for (const stmt of statements) {
      await db.exec(stmt);
    }
  }
}

/** Insert minimum parent rows so FK-constrained inserts on `messages` succeed. */
export async function seedParents(db: D1Database, opts: {
  userId: string;
  serverId: string;
  channelId: string;
}): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(opts.userId, "Test", `${opts.userId}@test`, 1, now, now),
    db.prepare(`INSERT INTO servers (id, slug, name, owner_id, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .bind(opts.serverId, opts.serverId, "Test Server", opts.userId, now),
    db.prepare(`INSERT INTO channels (id, server_id, name, type, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .bind(opts.channelId, opts.serverId, "general", "public", now),
    db.prepare(`INSERT INTO channel_members (channel_id, member_id, member_type, joined_at)
                VALUES (?, ?, ?, ?)`)
      .bind(opts.channelId, opts.userId, "human", now),
  ]);
}

// Schema/migration application + parent-row seeding for tests.
// Migrations are imported as raw text via vite's `?raw` query so they're
// embedded into the worker bundle (fs is sandboxed inside the test runtime).
import migration0 from "../../db/migrations/0000_initial.sql?raw";
import migration1 from "../../db/migrations/0001_add_reactions_unread_edits.sql?raw";
import migration2 from "../../db/migrations/0002_add_invites.sql?raw";

const ALL_SQL = [migration0, migration1, migration2].join("\n");

export async function applySchema(db: D1Database): Promise<void> {
  // Drizzle marks per-statement boundaries with this sentinel.
  const statements = ALL_SQL
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    // exec() runs a single statement; collapse internal newlines first.
    await db.exec(stmt.replace(/\n+/g, " "));
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

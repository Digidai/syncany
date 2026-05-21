-- 0008_default_server.sql
--
-- Adds `user.default_server_id` to track the workspace the user lands on
-- after sign-in and that the setup wizard targets. Set by runOnboarding
-- to the personal workspace it auto-creates; user-editable from
-- Settings → Account. Nullable for pre-existing users (read paths fall
-- back via /api/v1/me's resolution chain: column → earliest owned →
-- earliest joined).
--
-- D1 / SQLite notes:
--   • ADD COLUMN on a 100-row staging / single-digit-MB DB is a
--     metadata-only fast path on SQLite; runs in milliseconds.
--   • The FK + ON DELETE SET NULL ensures dangling references after
--     workspace deletion get cleaned up automatically — without this,
--     /me's resolver would have to filter dead ids on every call.
--     SQLite enforces FK on-delete actions only when PRAGMA foreign_keys
--     is ON, which Wrangler / D1 sets by default.
--   • Index supports rare reverse lookups (who has this server as their
--     default), and is cheap to maintain.

ALTER TABLE `user` ADD COLUMN `default_server_id` text REFERENCES `servers`(`id`) ON DELETE SET NULL;
CREATE INDEX `ix_user_default_server` ON `user` (`default_server_id`);

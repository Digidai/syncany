-- P2 follow-up — strengthen user_connectors constraints (codex P2 schema review).
-- SQLite/D1 doesn't support ALTER TABLE ADD CONSTRAINT, so we recreate the
-- table with the new CHECKs + unique index. Safe to run on a non-empty
-- table because the integrity checks pass for any rows the app would have
-- inserted (kind is enum-enforced server-side; scopes are app-written JSON).
PRAGMA foreign_keys = OFF;--> statement-breakpoint

CREATE TABLE `user_connectors_new` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `kind` text NOT NULL CHECK (kind IN ('github','linear','notion')),
  `label` text NOT NULL,
  `encrypted_token` text NOT NULL,
  `scopes` text NOT NULL CHECK (json_valid(scopes)),
  `created_at` integer NOT NULL,
  `last_used_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

INSERT INTO user_connectors_new SELECT * FROM user_connectors;--> statement-breakpoint

DROP TABLE user_connectors;--> statement-breakpoint

ALTER TABLE user_connectors_new RENAME TO user_connectors;--> statement-breakpoint

CREATE INDEX `idx_uc_user` ON `user_connectors` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_uc_user_kind` ON `user_connectors` (`user_id`,`kind`);--> statement-breakpoint
-- (user_id, label) — prevent silent collision when a user adds two
-- connectors with identical labels.
CREATE UNIQUE INDEX `ux_uc_user_label` ON `user_connectors` (`user_id`,`label`);--> statement-breakpoint

PRAGMA foreign_keys = ON;

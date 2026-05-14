CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`invited_by` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`max_uses` integer DEFAULT 0 NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_invites_server` ON `invites` (`server_id`);--> statement-breakpoint
CREATE INDEX `ix_invites_invited_by` ON `invites` (`invited_by`);
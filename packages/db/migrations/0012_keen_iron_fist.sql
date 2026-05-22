CREATE TABLE `agent_connectors` (
	`agent_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`enabled_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `connector_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `user_connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ac_agent` ON `agent_connectors` (`agent_id`);--> statement-breakpoint
CREATE TABLE `user_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`encrypted_token` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_uc_user` ON `user_connectors` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_uc_user_kind` ON `user_connectors` (`user_id`,`kind`);
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_account_provider_account` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `ix_account_user` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`system_prompt` text,
	`model` text DEFAULT 'sonnet' NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_agents_server_name` ON `agents` (`server_id`,`name`);--> statement-breakpoint
CREATE INDEX `ix_agents_owner` ON `agents` (`owner_id`);--> statement-breakpoint
CREATE INDEX `ix_agents_status` ON `agents` (`status`);--> statement-breakpoint
CREATE TABLE `channel_members` (
	`channel_id` text NOT NULL,
	`member_id` text NOT NULL,
	`member_type` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `member_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_cm_member` ON `channel_members` (`member_id`);--> statement-breakpoint
CREATE INDEX `ix_cm_member_type` ON `channel_members` (`member_id`,`member_type`);--> statement-breakpoint
CREATE INDEX `ix_cm_channel_type` ON `channel_members` (`channel_id`,`member_type`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'public' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_channels_server_name` ON `channels` (`server_id`,`name`);--> statement-breakpoint
CREATE INDEX `ix_channels_server_type` ON `channels` (`server_id`,`type`);--> statement-breakpoint
CREATE INDEX `ix_channels_created_by` ON `channels` (`created_by`);--> statement-breakpoint
CREATE TABLE `machine_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`server_id` text NOT NULL,
	`name` text DEFAULT 'Default' NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `machine_keys_key_hash_unique` ON `machine_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `ix_mk_user` ON `machine_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_mk_server` ON `machine_keys` (`server_id`);--> statement-breakpoint
CREATE INDEX `ix_mk_hash` ON `machine_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`sender_type` text NOT NULL,
	`content` text NOT NULL,
	`seq` integer NOT NULL,
	`thread_parent_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_messages_channel_seq` ON `messages` (`channel_id`,`seq`);--> statement-breakpoint
CREATE INDEX `ix_messages_channel_created` ON `messages` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_messages_thread` ON `messages` (`thread_parent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_messages_sender` ON `messages` (`sender_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `server_members` (
	`server_id` text NOT NULL,
	`member_id` text NOT NULL,
	`member_type` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`server_id`, `member_id`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_sm_member` ON `server_members` (`member_id`);--> statement-breakpoint
CREATE INDEX `ix_sm_server_role` ON `server_members` (`server_id`,`role`);--> statement-breakpoint
CREATE INDEX `ix_sm_type` ON `server_members` (`server_id`,`member_type`);--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `servers_slug_unique` ON `servers` (`slug`);--> statement-breakpoint
CREATE INDEX `ix_servers_owner` ON `servers` (`owner_id`);--> statement-breakpoint
CREATE INDEX `ix_servers_slug` ON `servers` (`slug`);--> statement-breakpoint
CREATE INDEX `ix_servers_created` ON `servers` (`created_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `ix_session_user` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_session_expires` ON `session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`task_number` integer NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`assignee_id` text,
	`assignee_type` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_message_id_unique` ON `tasks` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_tasks_channel_num` ON `tasks` (`channel_id`,`task_number`);--> statement-breakpoint
CREATE INDEX `ix_tasks_assignee` ON `tasks` (`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_tasks_status` ON `tasks` (`channel_id`,`status`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `ix_user_email` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_verification_identifier` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `ix_verification_expires` ON `verification` (`expires_at`);
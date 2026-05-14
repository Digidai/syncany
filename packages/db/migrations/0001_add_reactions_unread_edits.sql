CREATE TABLE `reactions` (
	`message_id` text NOT NULL,
	`reactor_id` text NOT NULL,
	`reactor_type` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`message_id`, `reactor_id`, `emoji`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_reactions_message` ON `reactions` (`message_id`);--> statement-breakpoint
ALTER TABLE `channel_members` ADD `last_read_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `edited_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `deleted_at` integer;
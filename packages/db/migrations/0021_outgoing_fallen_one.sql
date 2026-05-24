PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_message_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`channel_id` text NOT NULL,
	`uploader_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_message_attachments`("id", "message_id", "channel_id", "uploader_id", "r2_key", "filename", "content_type", "size_bytes", "width", "height", "created_at") SELECT "id", "message_id", "channel_id", "uploader_id", "r2_key", "filename", "content_type", "size_bytes", "width", "height", "created_at" FROM `message_attachments`;--> statement-breakpoint
DROP TABLE `message_attachments`;--> statement-breakpoint
ALTER TABLE `__new_message_attachments` RENAME TO `message_attachments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ix_attachments_message` ON `message_attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `ix_attachments_channel_created` ON `message_attachments` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_attachments_orphan` ON `message_attachments` (`created_at`) WHERE message_id IS NULL;--> statement-breakpoint
CREATE INDEX `ix_attachments_uploader_created` ON `message_attachments` (`uploader_id`,`created_at`);
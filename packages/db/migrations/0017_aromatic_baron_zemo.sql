ALTER TABLE `channel_members` ADD `muted_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `pinned_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `pinned_by` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `ix_messages_pinned` ON `messages` (`channel_id`,`pinned_at`) WHERE pinned_at IS NOT NULL;
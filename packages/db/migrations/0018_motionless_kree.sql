ALTER TABLE `channels` ADD `topic` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `archived_by` text REFERENCES user(id);
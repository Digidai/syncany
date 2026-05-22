ALTER TABLE `messages` ADD `vector_indexed_at` integer;--> statement-breakpoint
CREATE INDEX `ix_messages_unindexed` ON `messages` (`created_at`) WHERE vector_indexed_at IS NULL;
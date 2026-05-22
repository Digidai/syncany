CREATE TABLE `agent_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`predicate` text NOT NULL,
	`object` text NOT NULL,
	`source_message_id` text,
	`confidence` real DEFAULT 0.8 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`superseded_by` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_facts_agent_subject` ON `agent_facts` (`agent_id`,`subject_kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_facts_active` ON `agent_facts` (`agent_id`) WHERE superseded_by IS NULL;
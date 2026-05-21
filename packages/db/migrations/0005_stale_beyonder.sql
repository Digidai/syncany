ALTER TABLE `agents` ADD `runtime` text DEFAULT 'claude' NOT NULL;--> statement-breakpoint
ALTER TABLE `machine_keys` ADD `last_detected_runtimes` text;--> statement-breakpoint
ALTER TABLE `machine_keys` ADD `last_detected_at` integer;
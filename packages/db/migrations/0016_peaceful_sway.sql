CREATE TABLE `newsletter_signups` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`page` text,
	`utm_source` text,
	`utm_campaign` text,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_newsletter_email` ON `newsletter_signups` (`email`);--> statement-breakpoint
CREATE INDEX `idx_newsletter_created` ON `newsletter_signups` (`created_at`);--> statement-breakpoint
CREATE TABLE `waitlist_signups` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`team_size` text,
	`use_case` text,
	`utm_source` text,
	`utm_campaign` text,
	`referer_path` text,
	`ip` text,
	`user_agent` text,
	`status` text DEFAULT 'new' NOT NULL,
	`admin_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_waitlist_created` ON `waitlist_signups` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_waitlist_status` ON `waitlist_signups` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_waitlist_email_path` ON `waitlist_signups` (`email`,`referer_path`);
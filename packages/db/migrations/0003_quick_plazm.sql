PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
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
INSERT INTO `__new_tasks`("id", "message_id", "channel_id", "task_number", "status", "assignee_id", "assignee_type", "created_at", "updated_at") SELECT "id", "message_id", "channel_id", "task_number", "status", "assignee_id", "assignee_type", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_message_id_unique` ON `tasks` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_tasks_channel_num` ON `tasks` (`channel_id`,`task_number`);--> statement-breakpoint
CREATE INDEX `ix_tasks_assignee` ON `tasks` (`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_tasks_status` ON `tasks` (`channel_id`,`status`);
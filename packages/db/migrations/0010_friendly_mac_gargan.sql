-- 0010_friendly_mac_gargan.sql
--
-- P0 W2 (DESIGN_agent_platform_v2 §8): add agent runtime location +
-- migration status columns. 'bridge' default keeps every existing row
-- pointing at the local-bridge runtime — no behavior change for current
-- users. Cloud-mode agents created post-P0 will use 'raltic'.
--
-- Drizzle's auto-generated form also wanted to recreate the `user` table
-- to materialise the `default_server_id` FK (added in raw SQL by 0008).
-- That FK is ALREADY present in the live DB; the recreate was a
-- snapshot-vs-DB drift fix only. Stripped here to avoid a needless
-- table rebuild + downtime on the user table.
ALTER TABLE `agents` ADD `runtime_mode` text DEFAULT 'bridge' NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `migration_status` text DEFAULT 'stable' NOT NULL;

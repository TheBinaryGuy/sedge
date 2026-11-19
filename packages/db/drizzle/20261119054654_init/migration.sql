CREATE TABLE `inbox` (
	`id` text PRIMARY KEY,
	`source` text NOT NULL,
	`prompt` text NOT NULL,
	`cwd` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE TABLE `timers` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL UNIQUE,
	`cron` text NOT NULL,
	`prompt` text NOT NULL,
	`cwd` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run_at` integer NOT NULL,
	`last_run_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inbox_status_created_idx` ON `inbox` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `timers_due_idx` ON `timers` (`enabled`,`next_run_at`);
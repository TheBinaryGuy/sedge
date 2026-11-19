CREATE TABLE `approvals` (
	`id` text PRIMARY KEY,
	`thread` text NOT NULL,
	`tool_name` text NOT NULL,
	`input_hash` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE TABLE `inbox` (
	`id` text PRIMARY KEY,
	`source` text NOT NULL,
	`external_id` text,
	`thread` text NOT NULL,
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
CREATE TABLE `kv` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY,
	`thread` text NOT NULL,
	`kind` text DEFAULT 'message' NOT NULL,
	`text` text NOT NULL,
	`approval_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE TABLE `timers` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`thread` text NOT NULL,
	`name` text,
	`cron` text,
	`prompt` text NOT NULL,
	`cwd` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`next_run_at` integer NOT NULL,
	`last_run_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `approvals_lookup_idx` ON `approvals` (`thread`,`input_hash`,`status`);--> statement-breakpoint
CREATE INDEX `inbox_status_created_idx` ON `inbox` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_source_external_idx` ON `inbox` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `outbox_due_idx` ON `outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `outbox_thread_idx` ON `outbox` (`thread`,`created_at`);--> statement-breakpoint
CREATE INDEX `timers_due_idx` ON `timers` (`status`,`next_run_at`);
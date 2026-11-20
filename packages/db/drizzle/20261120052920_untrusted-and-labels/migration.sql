ALTER TABLE `inbox` ADD `untrusted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox` ADD `label` text;--> statement-breakpoint
ALTER TABLE `timers` ADD `untrusted` integer DEFAULT false NOT NULL;
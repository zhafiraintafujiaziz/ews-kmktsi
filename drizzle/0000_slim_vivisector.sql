CREATE TABLE `alert_history` (
	`feed` text NOT NULL,
	`record_id` text NOT NULL,
	`revision` text NOT NULL,
	`record` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`feed`, `record_id`, `revision`)
);
--> statement-breakpoint
CREATE INDEX `alert_history_first_seen_idx` ON `alert_history` (`first_seen_at`);--> statement-breakpoint
CREATE TABLE `browser_imports` (
	`browser_id` text PRIMARY KEY NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checklist_items` (
	`office_id` text NOT NULL,
	`item_id` text NOT NULL,
	`checked` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`office_id`, `item_id`)
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reports_created_at_idx` ON `reports` (`created_at`);
CREATE TABLE `iqair_controls` (
	`key` text PRIMARY KEY NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `iqair_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`province` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `iqair_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`method` text NOT NULL,
	`attempted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `iqair_requests_time_idx` ON `iqair_requests` (`method`,`attempted_at`);--> statement-breakpoint
CREATE TABLE `iqair_snapshots` (
	`key` text PRIMARY KEY NOT NULL,
	`retrieved_at` integer NOT NULL,
	`data` text NOT NULL
);

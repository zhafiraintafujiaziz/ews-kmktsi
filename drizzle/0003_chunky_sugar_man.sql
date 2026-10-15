CREATE TABLE `ispu_daily_readings` (
	`collection_date` text NOT NULL,
	`station_id` text NOT NULL,
	`name` text NOT NULL,
	`city` text NOT NULL,
	`province` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`value` real NOT NULL,
	`category` text NOT NULL,
	`dominant_pollutant` text NOT NULL,
	`source_time_text` text NOT NULL,
	`source_time_label` text NOT NULL,
	`source_timezone` text NOT NULL,
	`observed_at` text,
	`quality_flags` text NOT NULL,
	PRIMARY KEY(`collection_date`, `station_id`),
	FOREIGN KEY (`collection_date`) REFERENCES `ispu_daily_runs`(`collection_date`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ispu_readings_station_date_idx` ON `ispu_daily_readings` (`station_id`,`collection_date`);--> statement-breakpoint
CREATE TABLE `ispu_daily_runs` (
	`collection_date` text PRIMARY KEY NOT NULL,
	`scheduled_at` text NOT NULL,
	`fetched_at` text,
	`completed_at` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`station_count` integer NOT NULL,
	`accepted_count` integer NOT NULL,
	`rejected_count` integer NOT NULL,
	`stale_count` integer NOT NULL,
	`undated_count` integer NOT NULL,
	`error_summary` text,
	`raw_response` text
);

CREATE TABLE `google_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted_refresh_token` text NOT NULL,
	`folder_id` text NOT NULL,
	`connected_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `upload_session` (
	`id` text PRIMARY KEY NOT NULL,
	`uploader_name` text NOT NULL,
	`file_name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text NOT NULL,
	`drive_file_id` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);

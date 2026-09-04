CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expense_date` text NOT NULL,
	`category` text NOT NULL,
	`amount_kopecks` integer NOT NULL,
	`method` text NOT NULL,
	`document_number` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_expenses_date` ON `expenses` (`expense_date`);--> statement-breakpoint
CREATE TABLE `intensity_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_date` text NOT NULL,
	`units` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_intensity_entries_date_unique` ON `intensity_entries` (`entry_date`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period` text NOT NULL,
	`invoice_number` text NOT NULL,
	`invoice_date` text NOT NULL,
	`kind` text NOT NULL,
	`amount_kopecks` integer NOT NULL,
	`due_date` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_invoices_period_date` ON `invoices` (`period`,`invoice_date`);--> statement-breakpoint
CREATE TABLE `month_closures` (
	`period` text PRIMARY KEY NOT NULL,
	`actual_units` integer NOT NULL,
	`included_units` integer NOT NULL,
	`excess_units` integer NOT NULL,
	`base_kopecks` integer NOT NULL,
	`rate_kopecks` integer NOT NULL,
	`variable_kopecks` integer NOT NULL,
	`total_kopecks` integer NOT NULL,
	`closed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`payment_date` text NOT NULL,
	`amount_kopecks` integer NOT NULL,
	`method` text NOT NULL,
	`document_number` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_payments_invoice_date` ON `payments` (`invoice_id`,`payment_date`);--> statement-breakpoint
PRAGMA optimize;

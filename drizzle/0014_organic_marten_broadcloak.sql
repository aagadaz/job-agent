ALTER TABLE "applications" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "applied_at" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "responded_at" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "interviewed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "weekly_goal" integer DEFAULT 10 NOT NULL;
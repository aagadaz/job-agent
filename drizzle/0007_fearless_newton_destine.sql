ALTER TABLE "profiles" ADD COLUMN "max_experience_years" integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE "user_offers" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "user_offers" ADD COLUMN "required_years" integer;
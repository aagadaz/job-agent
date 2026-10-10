ALTER TABLE "offers" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "areas" jsonb DEFAULT '[]'::jsonb NOT NULL;
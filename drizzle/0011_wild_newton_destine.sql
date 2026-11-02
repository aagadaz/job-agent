ALTER TYPE "public"."ats" ADD VALUE 'personio';--> statement-breakpoint
ALTER TYPE "public"."ats" ADD VALUE 'teamtailor';--> statement-breakpoint
CREATE TABLE "catalog_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ats" "ats" NOT NULL,
	"slug" text NOT NULL,
	"sector" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"countries" text[] DEFAULT '{}' NOT NULL,
	"job_count" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_ats_slug" UNIQUE("ats","slug")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "sheet_gid" integer;
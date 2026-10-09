ALTER TYPE "public"."ats" ADD VALUE 'workday';--> statement-breakpoint
ALTER TYPE "public"."ats" ADD VALUE 'workable';--> statement-breakpoint
ALTER TYPE "public"."ats" ADD VALUE 'recruitee';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "sheet_id" text;
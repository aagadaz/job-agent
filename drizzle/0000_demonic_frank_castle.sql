CREATE TYPE "public"."ats" AS ENUM('greenhouse', 'lever', 'ashby', 'smartrecruiters');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'success', 'error');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('a_traiter', 'postule', 'entretien', 'refuse', 'abandonne');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('postuler', 'a_etudier', 'ignorer');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ats" "ats" NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_user_ats_slug" UNIQUE("user_id","ats","slug")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"salary" text DEFAULT '' NOT NULL,
	"employment_type" text DEFAULT '' NOT NULL,
	"date_posted" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"qualifications" text DEFAULT '' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"location" text DEFAULT 'Paris' NOT NULL,
	"exclude_terms" text[] DEFAULT '{}' NOT NULL,
	"reject_threshold" integer DEFAULT 35 NOT NULL,
	"cv_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"stats" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_offers" (
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"score" integer,
	"verdict" "verdict",
	"justification" text DEFAULT '' NOT NULL,
	"strengths" text[] DEFAULT '{}' NOT NULL,
	"missing_skills" text[] DEFAULT '{}' NOT NULL,
	"rejected" boolean DEFAULT false NOT NULL,
	"status" "application_status" DEFAULT 'a_traiter' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_offers_user_id_offer_id_pk" PRIMARY KEY("user_id","offer_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"anthropic_key_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_offers" ADD CONSTRAINT "user_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_offers" ADD CONSTRAINT "user_offers_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_offers_user_score_idx" ON "user_offers" USING btree ("user_id","score");
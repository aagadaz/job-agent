CREATE TABLE "cvs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"file_name" text,
	"file_data" "bytea",
	"file_size" integer,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "active_cv_id" uuid;--> statement-breakpoint
ALTER TABLE "cvs" ADD CONSTRAINT "cvs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cvs_user_idx" ON "cvs" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_active_cv_id_cvs_id_fk" FOREIGN KEY ("active_cv_id") REFERENCES "public"."cvs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Reprise : le CV actuel de chaque profil (texte seul, le PDF n'était pas conservé) devient le
-- premier CV de sa bibliothèque, et le CV actif.
INSERT INTO "cvs" ("user_id", "name", "text", "created_at", "updated_at")
SELECT "user_id", 'CV principal', "cv_text", "updated_at", "updated_at"
FROM "profiles"
WHERE "cv_text" IS NOT NULL AND "cv_text" <> '';
--> statement-breakpoint
UPDATE "profiles" p SET "active_cv_id" = c."id"
FROM "cvs" c
WHERE c."user_id" = p."user_id" AND p."active_cv_id" IS NULL;

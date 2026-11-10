-- Statut unique : l'étape de la candidature (applications.stage) devient la seule source de
-- vérité. Avant de supprimer user_offers.status, on reprend les offres du fil déjà passées en
-- « Postulé / Entretien / Refusé / Abandonné » qui n'ont pas encore leur ligne de suivi.
-- (Celles retirées du suivi à la main, untracked = true, redeviennent « à traiter ».)
INSERT INTO "applications" ("user_id", "offer_id", "company", "title", "url", "origin", "contract", "stage", "last_contact", "applied_at", "responded_at", "interviewed")
SELECT
  uo."user_id", o."id", o."company", o."title", o."url", 'agent',
  CASE
    WHEN lower(o."employment_type") ~ '\mcdd\M|temporary' THEN 'CDD'
    WHEN lower(o."employment_type") ~ 'stage|intern' THEN 'Stage'
    WHEN lower(o."employment_type") ~ 'alternance|apprenti' THEN 'Alternance'
    WHEN lower(o."employment_type") ~ 'freelance|contract|indépendant' THEN 'Freelance'
    ELSE 'CDI'
  END,
  s.stage::"application_stage",
  uo."created_at"::date,
  uo."created_at"::date,
  CASE WHEN s.stage IN ('in_conversation', 'unsuccessful') THEN uo."created_at"::date END,
  s.stage = 'in_conversation'
FROM "user_offers" uo
JOIN "offers" o ON o."id" = uo."offer_id"
CROSS JOIN LATERAL (
  SELECT CASE uo."status"
    WHEN 'postule' THEN 'applied'
    WHEN 'entretien' THEN 'in_conversation'
    WHEN 'refuse' THEN 'unsuccessful'
    WHEN 'abandonne' THEN 'closed'
  END AS stage
) s
WHERE uo."status" <> 'a_traiter' AND uo."untracked" = false
ON CONFLICT ("user_id", "offer_id") DO NOTHING;
--> statement-breakpoint
-- Jalons manquants (rattrapage qui tournait jusqu'ici à chaque ouverture de l'onglet Candidatures)
UPDATE "applications" SET
  "origin" = CASE WHEN "origin" = 'manual' AND "offer_id" IS NOT NULL THEN 'agent' ELSE "origin" END,
  "applied_at" = CASE WHEN "stage" <> 'not_started' THEN coalesce("applied_at", "last_contact", "created_at"::date) ELSE "applied_at" END,
  "responded_at" = CASE WHEN "stage" IN ('in_conversation', 'unsuccessful', 'committed') THEN coalesce("responded_at", "last_contact", "updated_at"::date) ELSE "responded_at" END,
  "interviewed" = "interviewed" OR "stage" IN ('in_conversation', 'committed')
WHERE ("origin" = 'manual' AND "offer_id" IS NOT NULL)
  OR ("stage" <> 'not_started' AND "applied_at" IS NULL)
  OR ("stage" IN ('in_conversation', 'unsuccessful', 'committed') AND "responded_at" IS NULL)
  OR ("stage" IN ('in_conversation', 'committed') AND NOT "interviewed");
--> statement-breakpoint
CREATE INDEX "user_offers_user_created_idx" ON "user_offers" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "user_offers" DROP COLUMN "untracked";--> statement-breakpoint
ALTER TABLE "user_offers" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."application_status";
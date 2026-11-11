ALTER TABLE "profiles" ADD COLUMN "contract_types" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Comptes existants : jusqu'ici la recherche Adzuna ne ramenait que des CDI (permanent=1).
-- On le reprend comme critère explicite, visible (et modifiable) dans le profil.
UPDATE "profiles" SET "contract_types" = '{CDI}';

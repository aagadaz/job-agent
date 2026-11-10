import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, jsonb, date,
  primaryKey, unique, index,
} from 'drizzle-orm/pg-core';
import type { SearchArea } from '../lib/countries';

export type RejectReason = 'score' | 'experience' | 'expired' | 'source';

// ─── Énumérations : des ensembles fermés de valeurs, vérifiés par PostgreSQL ───
// Ajouter une valeur = migration "ALTER TYPE ... ADD VALUE" (toujours en fin de liste)
export const atsEnum = pgEnum('ats', [
  'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'workable', 'recruitee', 'personio', 'teamtailor', 'website',
]);
export const verdictEnum = pgEnum('verdict', ['postuler', 'a_etudier', 'ignorer']);
export const runStatusEnum = pgEnum('run_status', ['running', 'success', 'error']);

// ─── Utilisateurs ───
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  // Clé API Anthropic chiffrée (AES-256-GCM, étape 11). Jamais stockée en clair.
  anthropicKeyEncrypted: text('anthropic_key_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Profil de recherche : relation 1-1 avec users (la clé primaire EST la clé étrangère) ───
export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  keywords: text('keywords').array().notNull().default([]),      // vide → déduits du CV par Claude
  location: text('location').notNull().default('Paris'), // ancien champ, remplacé par `areas` (à supprimer plus tard)
  // Zones de recherche : [{ country: 'fr', city: 'Paris' }, { country: 'lu', city: '' }]
  areas: jsonb('areas').$type<SearchArea[]>().notNull().default([]),
  excludeTerms: text('exclude_terms').array().notNull().default([]), // ex. ['senior', 'lead']
  includeTerms: text('include_terms').array().notNull().default([]), 
  rejectThreshold: integer('reject_threshold').notNull().default(35),
  // Offres exigeant PLUS que ce nombre d'années d'expérience → écartées. null = pas de limite.
  maxExperienceYears: integer('max_experience_years').default(5),
  // Recherche Adzuna (agrégateur) activée ? false = pages carrières uniquement
  useAdzuna: boolean('use_adzuna').notNull().default(true),
  cvText: text('cv_text'),
  sheetId: text('sheet_id'), // Google Sheet de suivi des candidatures (facultatif)
  // Onglet choisi (le #gid=… de l'URL). null = onglet « Candidatures » géré par l'application
  sheetGid: integer('sheet_gid'),
  // Objectif de candidatures par semaine (tableau de bord de l'onglet Candidatures)
  weeklyGoal: integer('weekly_goal').notNull().default(10),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Entreprises suivies, par utilisateur ───
export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  ats: atsEnum('ats').notNull(),
  slug: text('slug').notNull(),                 // identifiant de l'entreprise chez l'ATS
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('companies_user_ats_slug').on(t.userId, t.ats, t.slug), // pas deux fois la même entreprise
]);

// ─── Catalogue partagé d'entreprises VÉRIFIÉES (ATS lisible, offres publiées) ───
// Alimenté par le script src/tools/build-catalog.ts ; chaque utilisateur y pioche en un clic.
export const catalogCompanies = pgTable('catalog_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ats: atsEnum('ats').notNull(),
  slug: text('slug').notNull(),
  sector: text('sector').notNull().default(''),     // libellé libre : « IA / Santé », « Conseil data »…
  category: text('category').notNull().default(''), // AI & tech · Consulting · Financial services · Industry
  countries: text('countries').array().notNull().default([]),
  jobCount: integer('job_count').notNull().default(0),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('catalog_ats_slug').on(t.ats, t.slug),
]);

// ─── Offres : partagées entre tous les utilisateurs, uniques par URL normalisée ───
export const offers = pgTable('offers', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull().unique(),          // la contrainte UNIQUE remplace le Set de sheets.ts
  source: text('source').notNull(),             // 'adzuna', 'greenhouse', ...
  title: text('title').notNull(),
  company: text('company').notNull(),
  location: text('location').notNull().default(''),
  salary: text('salary').notNull().default(''),
  employmentType: text('employment_type').notNull().default(''),
  datePosted: text('date_posted').notNull().default(''),
  description: text('description').notNull().default(''),
  qualifications: text('qualifications').notNull().default(''),
  country: text('country'), // code ISO déduit du lieu (ou du pays de recherche Adzuna) ; null = inconnu
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  // Signalée « fermée » par un utilisateur qui a voulu postuler. L'offre étant PARTAGÉE, le
  // signalement profite à tous : elle est écartée du fil de chacun. null = pas de signalement.
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

// ─── Table d'association utilisateur ↔ offre : le score et le suivi sont PERSONNELS ───
export const userOffers = pgTable('user_offers', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  offerId: uuid('offer_id').notNull().references(() => offers.id, { onDelete: 'cascade' }),
  score: integer('score'),                      // null = scoring échoué
  verdict: verdictEnum('verdict'),
  justification: text('justification').notNull().default(''),
  strengths: text('strengths').array().notNull().default([]),
  missingSkills: text('missing_skills').array().notNull().default([]),
  rejected: boolean('rejected').notNull().default(false), // score <= seuil : remplace l'onglet "rejetees"
  // Pourquoi l'offre est écartée : 'score' (note sous le seuil), 'experience' (trop d'années
  // exigées), 'expired' (plus vue par les sources : probablement fermée) ou 'source' (source
  // désactivée dans le profil). null = retenue.
  rejectReason: text('reject_reason').$type<RejectReason>(),
  requiredYears: integer('required_years'), // années d'expérience exigées, si le texte le dit
  coverLetter: text('cover_letter'), // brouillon de lettre de motivation (généré puis éditable)
  // Pas de colonne « statut » : il se lit dans applications (étape de la candidature liée),
  // « à traiter » = aucune candidature. Cf. src/lib/status.ts.
  // Suppression LOGIQUE : la ligne reste (le worker sait que l'offre est déjà vue et ne la
  // re-note pas), elle est seulement masquée du fil. null = visible.
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.offerId] }), // une ligne par (utilisateur, offre), pas plus
  index('user_offers_user_score_idx').on(t.userId, t.score), // pour le tableau trié par score
  index('user_offers_user_created_idx').on(t.userId, t.createdAt), // tri « récentes », filtre « ajoutées depuis »
]);

// ─── Historique des exécutions du worker ───
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: runStatusEnum('status').notNull().default('running'),
  stats: jsonb('stats').$type<{ fetched?: number; afterFilters?: number; new?: number; kept?: number; rejected?: number; unscored?: number; tooSenior?: number; expired?: number }>(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

// Types TypeScript dérivés du schéma : une seule source de vérité
export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type NewOffer = typeof offers.$inferInsert;
export type UserOffer = typeof userOffers.$inferSelect;

// ─── Réglages de la plateforme (modifiables depuis /admin, sans redéployer) ───
// Une ligne par réglage : clé + valeur JSON. Les valeurs par défaut vivent dans le code
// (src/db/settings.ts) : une table vide = comportement par défaut.
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Liens magiques de connexion ───
// On ne stocke JAMAIS le jeton lui-même, seulement son empreinte SHA-256 : une fuite de la base
// ne permet pas de se connecter. Usage unique (usedAt) et durée de vie courte (expiresAt).
export const loginTokens = pgTable('login_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('login_tokens_email_created_idx').on(t.email, t.createdAt), // anti-abus : liens récents par e-mail
]);

// ─── Suivi des candidatures (onglet « Candidatures ») ───
// Calqué sur le Google Sheet de suivi : Entreprise · Type d'entreprise · Poste (lien) · Type de
// contrat · Réponses (étape numérotée) · Last contact · Notes. Une candidature peut venir d'une
// offre de l'agent (offerId) ou être saisie à la main (recruteur LinkedIn, cooptation…).
export const applicationStageEnum = pgEnum('application_stage', [
  'not_started', 'applied', 'in_conversation', 'closed', 'unsuccessful', 'waiting', 'committed',
]);

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  offerId: uuid('offer_id').references(() => offers.id, { onDelete: 'set null' }), // null = saisie manuelle
  company: text('company').notNull(),
  companyType: text('company_type').notNull().default(''), // AI & tech · Consulting · Financial services · Industry
  title: text('title').notNull().default(''),
  url: text('url').notNull().default(''),
  contract: text('contract').notNull().default('CDI'),
  stage: applicationStageEnum('stage').notNull().default('applied'),
  lastContact: date('last_contact'),                        // AAAA-MM-JJ
  notes: text('notes').notNull().default(''),
  // ─── Pour le tableau de bord ───
  // D'où vient la ligne : 'agent' (fil), 'manual' (saisie), 'sheet' (import du Google Sheet)
  origin: text('origin').notNull().default('manual'),
  appliedAt: date('applied_at'),                            // date d'envoi (null = pas encore envoyée)
  respondedAt: date('responded_at'),                        // 1re réponse de l'entreprise (posée une seule fois)
  interviewed: boolean('interviewed').notNull().default(false), // a atteint « In conversation » au moins une fois
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('applications_user_idx').on(t.userId),
  unique('applications_user_offer').on(t.userId, t.offerId), // une offre de l'agent = une seule candidature
]);

// ─── Contacts dans les entreprises (onglet « Contacts ») ───
// Données personnelles de TIERS : visibles uniquement par l'utilisateur qui les saisit.
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  company: text('company').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default(''),
  email: text('email').notNull().default(''),
  linkedin: text('linkedin').notNull().default(''),
  notes: text('notes').notNull().default(''), // ex. « Alumni ESEO », « rencontré au salon »
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('contacts_user_idx').on(t.userId)]);

import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from './client';
import { users, profiles, companies, offers, userOffers, runs } from './schema';
import { STATUS_LABELS } from '../lib/status';
import type { SearchArea } from '../lib/countries';

// Requêtes de l'interface web. Règle d'or : CHAQUE requête filtre par userId,
// passé par le serveur à partir de la session — jamais par une valeur venant du navigateur.

export type ApplicationStatus = (typeof userOffers.status.enumValues)[number];
export const STATUSES = userOffers.status.enumValues;

// Vérification À LA COMPILATION : chaque statut de l'enum SQL a un libellé dans status.ts.
// Ajouter un statut au schéma sans libellé ferait échouer `npm run typecheck`.
const _everyStatusHasALabel: Record<ApplicationStatus, string> = STATUS_LABELS;
void _everyStatusHasALabel;

// ─── Comptes ───
export async function ensureUser(email: string, name: string | null): Promise<void> {
  await db.insert(users).values({ email, name }).onConflictDoNothing();
}

export async function findUserIdByEmail(email: string): Promise<string | undefined> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return row?.id;
}

// ─── Profil ───
export async function getUserWithProfile(userId: string) {
  const [row] = await db
    .select({ user: users, profile: profiles })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id)) // LEFT : le profil n'existe pas encore au 1er login
    .where(eq(users.id, userId));
  return row;
}

export interface ProfileInput {
  keywords: string[];
  areas: SearchArea[];
  includeTerms: string[];
  excludeTerms: string[];
  rejectThreshold: number;
  cvText?: string; // absent = on garde le CV actuel
}

export async function saveProfile(userId: string, input: ProfileInput): Promise<void> {
  const { cvText, ...rest } = input;
  const values = { ...rest, ...(cvText !== undefined ? { cvText } : {}), updatedAt: new Date() };
  await db
    .insert(profiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: profiles.userId, set: values });
}

/** Enregistre (ou efface avec null) le Google Sheet de l'utilisateur. */
export async function saveSheetId(userId: string, sheetId: string | null): Promise<void> {
  await db
    .insert(profiles)
    .values({ userId, sheetId })
    .onConflictDoUpdate({ target: profiles.userId, set: { sheetId, updatedAt: new Date() } });
}

export async function saveEncryptedKey(userId: string, encrypted: string): Promise<void> {
  await db.update(users).set({ anthropicKeyEncrypted: encrypted }).where(eq(users.id, userId));
}

// ─── Entreprises ───
export async function listCompanies(userId: string) {
  return db.select().from(companies).where(eq(companies.userId, userId)).orderBy(companies.name);
}

// Le type de 'ats' est DÉRIVÉ du schéma : ajouter un ATS à l'enum suffit, rien à recopier ici
/** Ajoute l'entreprise ; renvoie false si elle était déjà suivie (même ATS + identifiant). */
export async function insertCompany(userId: string, c: Pick<typeof companies.$inferInsert, 'name' | 'ats' | 'slug'>): Promise<boolean> {
  const inserted = await db.insert(companies).values({ userId, ...c }).onConflictDoNothing().returning({ id: companies.id });
  return inserted.length > 0; // ON CONFLICT DO NOTHING + RETURNING : 0 ligne = conflit
}

export async function deleteCompany(userId: string, companyId: string): Promise<void> {
  // userId dans le WHERE : impossible de supprimer l'entreprise d'un autre utilisateur
  await db.delete(companies).where(and(eq(companies.id, companyId), eq(companies.userId, userId)));
}

// ─── Offres ───
interface OfferFilters { showRejected: boolean; dismissed?: boolean }

/** Conditions communes au fil et à ses compteurs (mêmes règles = mêmes chiffres). */
function feedConditions(userId: string, opts: OfferFilters) {
  const conditions = [eq(userOffers.userId, userId)];
  // Corbeille : seulement les supprimées ; sinon, jamais les supprimées
  conditions.push(opts.dismissed ? isNotNull(userOffers.dismissedAt) : isNull(userOffers.dismissedAt));
  if (!opts.showRejected) conditions.push(eq(userOffers.rejected, false));
  return conditions;
}

/** Nombre d'offres par pays pour les onglets du fil ('none' = pays inconnu). */
export async function countOffersByCountry(userId: string, opts: OfferFilters) {
  const rows = await db
    .select({ country: offers.country, n: sql<number>`count(*)::int` })
    .from(userOffers)
    .innerJoin(offers, eq(offers.id, userOffers.offerId))
    .where(and(...feedConditions(userId, opts)))
    .groupBy(offers.country);
  return rows.map(r => ({ country: r.country ?? 'none', n: r.n })).sort((a, b) => b.n - a.n);
}

export async function listOffers(userId: string, opts: OfferFilters & { status?: ApplicationStatus; country?: string }) {
  const conditions = feedConditions(userId, opts);
  // 'none' = offres dont le pays n'a pas pu être déterminé
  if (opts.country) conditions.push(opts.country === 'none' ? isNull(offers.country) : eq(offers.country, opts.country));
  if (opts.status) conditions.push(eq(userOffers.status, opts.status));

  return db
    .select({
      offerId: offers.id,
      title: offers.title,
      company: offers.company,
      location: offers.location,
      country: offers.country,
      url: offers.url,
      source: offers.source,
      datePosted: offers.datePosted,
      score: userOffers.score,
      verdict: userOffers.verdict,
      justification: userOffers.justification,
      strengths: userOffers.strengths,
      missingSkills: userOffers.missingSkills,
      status: userOffers.status,
      rejected: userOffers.rejected,
    })
    .from(userOffers)
    .innerJoin(offers, eq(offers.id, userOffers.offerId))
    .where(and(...conditions))
    .orderBy(sql`${userOffers.score} desc nulls last`, desc(userOffers.createdAt))
    .limit(300);
}

/** Masque (dismissed = true) ou restaure une offre du fil — seulement les siennes. */
export async function setOfferDismissed(userId: string, offerId: string, dismissed: boolean): Promise<void> {
  await db
    .update(userOffers)
    .set({ dismissedAt: dismissed ? new Date() : null })
    .where(and(eq(userOffers.userId, userId), eq(userOffers.offerId, offerId)));
}

export async function setOfferStatus(userId: string, offerId: string, status: ApplicationStatus): Promise<void> {
  await db
    .update(userOffers)
    .set({ status })
    .where(and(eq(userOffers.userId, userId), eq(userOffers.offerId, offerId)));
}

/** Une offre complète, seulement si elle appartient à CET utilisateur (sinon undefined). */
export async function getOfferDetail(userId: string, offerId: string) {
  const [row] = await db
    .select({
      offerId: offers.id,
      title: offers.title,
      company: offers.company,
      location: offers.location,
      country: offers.country,
      salary: offers.salary,
      employmentType: offers.employmentType,
      datePosted: offers.datePosted,
      description: offers.description,
      qualifications: offers.qualifications,
      url: offers.url,
      source: offers.source,
      score: userOffers.score,
      verdict: userOffers.verdict,
      justification: userOffers.justification,
      strengths: userOffers.strengths,
      missingSkills: userOffers.missingSkills,
      status: userOffers.status,
      dismissedAt: userOffers.dismissedAt,
    })
    .from(userOffers)
    .innerJoin(offers, eq(offers.id, userOffers.offerId))
    .where(and(eq(userOffers.userId, userId), eq(userOffers.offerId, offerId)));
  return row;
}

/** Ce qu'il faut pour écrire la ligne du Sheet — toujours filtré par userId. */
export async function getApplicationForSheet(userId: string, offerId: string) {
  const [row] = await db
    .select({
      sheetId: profiles.sheetId,
      company: offers.company,
      title: offers.title,
      location: offers.location,
      url: offers.url,
      source: offers.source,
      score: userOffers.score,
    })
    .from(userOffers)
    .innerJoin(offers, eq(offers.id, userOffers.offerId))
    .innerJoin(profiles, eq(profiles.userId, userOffers.userId))
    .where(and(eq(userOffers.userId, userId), eq(userOffers.offerId, offerId)));
  return row;
}

// ─── Dernière exécution du worker ───
/** Crée la ligne "runs" dès le clic : l'interface affiche « en cours » sans attendre GitHub. */
export async function createManualRun(userId: string): Promise<string> {
  const [run] = await db.insert(runs).values({ userId }).returning({ id: runs.id });
  return run.id;
}

/** Clôt en erreur une ligne créée au clic quand le déclenchement GitHub a échoué. */
export async function failRun(userId: string, runId: string, error: string): Promise<void> {
  await db
    .update(runs)
    .set({ status: 'error', error, finishedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)));
}

export async function lastRun(userId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.userId, userId)).orderBy(desc(runs.startedAt)).limit(1);
  return run;
}

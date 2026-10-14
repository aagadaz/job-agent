import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from './client';
import { users, profiles, offers, userOffers, runs, companies } from './schema';
import type { JobDetail, ScoredOffer } from '../lib/types';
import { normalizeUrl } from '../lib/url';
import { requiredYears, tooMuchExperience } from '../lib/experience';
import type { RejectReason } from './schema';

// Toutes les requêtes SQL du worker sont ici : le reste du code ne parle jamais SQL.

/**
 * Utilisateurs prêts pour le worker (cf. src/lib/search-mode.ts) : clé Claude + CV (mode noté),
 * ou au moins un mot-clé (mode sans clé). Le worker recalcule le mode exact pour chacun.
 * `onlyUserId` : lancement manuel depuis l'interface, pour un seul utilisateur.
 */
export async function getActiveUsers(onlyUserId?: string) {
  return db
    .select({ user: users, profile: profiles })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        or(
          and(isNotNull(users.anthropicKeyEncrypted), isNotNull(profiles.cvText)),
          sql`cardinality(${profiles.keywords}) > 0`,
        ),
        onlyUserId ? eq(users.id, onlyUserId) : undefined, // and() ignore les undefined
      ),
    );
}

/** URLs des offres déjà vues par CET utilisateur (retenues ou écartées). */
export async function getSeenUrls(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ url: offers.url })
    .from(userOffers)
    .innerJoin(offers, eq(offers.id, userOffers.offerId))
    .where(eq(userOffers.userId, userId));
  return new Set(rows.map(r => r.url));
}

/**
 * Insère les offres dans la table partagée. Si l'URL existe déjà (collectée pour
 * un autre utilisateur), on ne la duplique pas. Renvoie url → id pour toutes les offres.
 */
export async function upsertOffers(input: JobDetail[]): Promise<Map<string, string>> {
  // PostgreSQL refuse qu'un même INSERT … ON CONFLICT DO UPDATE touche deux fois la même ligne
  // (« cannot affect row a second time ») : on dédoublonne le lot sur la clé, l'URL normalisée.
  const byUrl = new Map<string, JobDetail>();
  for (const j of input) if (!byUrl.has(normalizeUrl(j.url))) byUrl.set(normalizeUrl(j.url), j);
  const jobs = [...byUrl.values()];
  if (jobs.length === 0) return new Map();

  const rows = await db
    .insert(offers)
    .values(jobs.map(j => ({
      url: normalizeUrl(j.url),
      source: j.source,
      title: j.title,
      company: j.company,
      location: j.location,
      salary: j.salary,
      employmentType: j.employmentType,
      datePosted: j.datePosted,
      description: j.description,
      qualifications: j.qualifications,
      country: j.country ?? null,
    })))
    // DO UPDATE (et non DO NOTHING) pour que RETURNING renvoie aussi les lignes déjà existantes
    .onConflictDoUpdate({
      target: offers.url,
      // Pays : on garde celui déjà connu, sinon on prend le nouveau (excluded = la ligne qu'on tentait d'insérer)
      set: { fetchedAt: new Date(), country: sql`coalesce(${offers.country}, excluded.country)` },
    })
    .returning({ id: offers.id, url: offers.url });

  return new Map(rows.map(r => [r.url, r.id]));
}

/** Entreprises suivies par cet utilisateur. */
export async function getCompanies(userId: string) {
  return db.select().from(companies).where(eq(companies.userId, userId));
}

const VERDICT_TO_DB = { 'Postuler': 'postuler', 'À étudier': 'a_etudier', 'Ignorer': 'ignorer' } as const;

/** Enregistre le score personnel de chaque offre pour cet utilisateur. */
export async function insertUserOffers(
  userId: string,
  scored: ScoredOffer[],
  offerIds: Map<string, string>,
  rejectThreshold: number,
): Promise<{ kept: number; rejected: number }> {
  let kept = 0;
  let rejected = 0;

  const values = scored.flatMap(o => {
    const offerId = offerIds.get(normalizeUrl(o.url));
    if (!offerId) return [];
    const isRejected = o.scoring !== null && o.scoring.score <= rejectThreshold;
    // Les autres motifs (expérience, offre fermée) sont posés juste après par reconcileFeed
    isRejected ? rejected++ : kept++;
    return [{
      userId,
      offerId,
      score: o.scoring?.score ?? null,
      verdict: o.scoring ? VERDICT_TO_DB[o.scoring.verdict] : null,
      justification: o.scoring?.justification ?? '',
      strengths: o.scoring?.strengths ?? [],
      missingSkills: o.scoring?.missingSkills ?? [],
      rejected: isRejected,
      rejectReason: isRejected ? ('score' as const) : null,
      requiredYears: requiredYears(o.title, o.description, o.qualifications),
    }];
  });

  if (values.length > 0) {
    await db.insert(userOffers).values(values).onConflictDoNothing(); // idempotent
  }
  return { kept, rejected };
}

export async function startRun(userId: string): Promise<string> {
  const [run] = await db.insert(runs).values({ userId }).returning({ id: runs.id });
  return run.id;
}

export async function finishRun(
  runId: string,
  outcome: { status: 'success' | 'error'; stats?: Record<string, number>; error?: string },
): Promise<void> {
  await db
    .update(runs)
    .set({ status: outcome.status, stats: outcome.stats, error: outcome.error, finishedAt: new Date() })
    .where(eq(runs.id, runId));
}

// ─── Fraîcheur des offres ───

/**
 * Deux règles, car les sources ne disent pas la même chose :
 *  - pages carrières (ATS) : on reçoit la liste COMPLÈTE des postes ouverts. Une offre absente
 *    depuis STALE_AFTER_DAYS jours a été retirée par l'employeur → fermée (fiable) ;
 *  - agrégateurs (Adzuna) : on ne reçoit que les 100 plus récentes par mot-clé. Une absence ne
 *    prouve rien ; on se rabat sur l'ÂGE : publiée il y a plus de AGGREGATOR_MAX_AGE_DAYS jours
 *    → probablement pourvue (les agrégateurs gardent souvent des annonces déjà closes).
 */
export const STALE_AFTER_DAYS = 3;
export const AGGREGATOR_MAX_AGE_DAYS = 21;
const AGGREGATORS = ['adzuna'];

/**
 * « Cette offre est toujours en ligne » : met à jour fetched_at de toutes les offres DÉJÀ en
 * base que les sources viennent de renvoyer (les nouvelles l'ont via upsertOffers).
 * Un seul paramètre tableau (= ANY($1)) plutôt qu'un IN (…) à N paramètres : PostgreSQL
 * plafonne à 65 535 paramètres par requête, et 100 pages carrières peuvent en dépasser 10 000.
 */
export async function touchOffers(urls: string[]): Promise<void> {
  const unique = [...new Set(urls.map(normalizeUrl))];
  if (unique.length === 0) return;
  // sql.param() : le tableau part comme UNE valeur (tableau PostgreSQL). Sans lui, Drizzle
  // « déplie » un tableau JS en liste ($1, $2, …) — c'est ce qu'il fait pour IN (…).
  await db.execute(sql`update offers set fetched_at = now() where url = any(${sql.param(unique)}::text[])`);
}

/**
 * Recalcule les motifs d'écart « automatiques » (expérience, offre fermée) du fil d'un
 * utilisateur. Rejouée à chaque passage, donc RÉVERSIBLE : une offre redevenue visible chez
 * la source, ou une limite d'expérience relevée dans le profil, ramène l'offre dans le fil.
 *
 * Ne touche jamais : les offres écartées par la note (décision de Claude), celles que
 * l'utilisateur a supprimées, ni celles dont il a changé le statut (il y a postulé, etc.).
 */
export async function reconcileFeed(userId: string, maxYears: number | null) {
  const rows = await db
    .select({
      offerId: userOffers.offerId,
      rejectReason: userOffers.rejectReason,
      requiredYears: userOffers.requiredYears,
      title: offers.title,
      description: offers.description,
      qualifications: offers.qualifications,
      // date_posted est un texte ISO (« 2026-10-01T09:30:00Z ») : la comparaison de chaînes
      // suit l'ordre chronologique ; '' (date inconnue) n'est jamais considérée trop vieille.
      stale: sql<boolean>`case
        when ${offers.closedAt} is not null then true
        when ${offers.source} = any(${sql.param(AGGREGATORS)}::text[])
          then ${offers.datePosted} <> '' and ${offers.datePosted} < to_char(now() - make_interval(days => ${AGGREGATOR_MAX_AGE_DAYS}), 'YYYY-MM-DD')
        else ${offers.fetchedAt} < now() - make_interval(days => ${STALE_AFTER_DAYS})
      end`,
    })
    .from(userOffers)
    .innerJoin(offers, eq(offers.id, userOffers.offerId))
    .where(and(
      eq(userOffers.userId, userId),
      eq(userOffers.status, 'a_traiter'),
      isNull(userOffers.dismissedAt),
      or(
        // retenues… (rejected = false : les offres écartées par la note AVANT l'ajout de
        // reject_reason ont rejected = true et un motif null ; on ne doit pas les ressusciter)
        and(isNull(userOffers.rejectReason), eq(userOffers.rejected, false)),
        // …ou écartées par un motif automatique, donc réévaluable
        inArray(userOffers.rejectReason, ['experience', 'expired']),
      ),
    ));

  // On regroupe par décision : 3 UPDATE au plus, quel que soit le nombre d'offres
  const groups = new Map<RejectReason | null, string[]>();
  const yearsToSave: { offerId: string; years: number }[] = [];
  for (const r of rows) {
    // Offres d'avant cette fonctionnalité : années jamais calculées → on les calcule maintenant
    const years = r.requiredYears ?? requiredYears(r.title, r.description, r.qualifications);
    if (r.requiredYears === null && years !== null) yearsToSave.push({ offerId: r.offerId, years });
    const reason: RejectReason | null = tooMuchExperience(years, maxYears) ? 'experience' : r.stale ? 'expired' : null;
    if (reason === r.rejectReason) continue; // déjà dans le bon état : rien à écrire
    groups.set(reason, [...(groups.get(reason) ?? []), r.offerId]);
  }

  for (const [reason, ids] of groups) {
    await db
      .update(userOffers)
      .set({ rejected: reason !== null, rejectReason: reason })
      .where(and(eq(userOffers.userId, userId), inArray(userOffers.offerId, ids)));
  }
  for (const { offerId, years } of yearsToSave) {
    await db.update(userOffers).set({ requiredYears: years })
      .where(and(eq(userOffers.userId, userId), eq(userOffers.offerId, offerId)));
  }

  const count = (reason: RejectReason) => groups.get(reason)?.length ?? 0;
  return { experience: count('experience'), expired: count('expired'), restored: groups.get(null)?.length ?? 0 };
}

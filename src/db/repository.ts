import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import { db } from './client';
import { users, profiles, offers, userOffers, runs, companies } from './schema';
import type { JobDetail, ScoredOffer } from '../lib/types';
import { normalizeUrl } from '../lib/url';

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

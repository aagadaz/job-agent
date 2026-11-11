import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from './client';
import { users, profiles, companies, offers, userOffers, runs, catalogCompanies, applications } from './schema';
import type { FeedStatus } from '../lib/status';
import { noApplication } from './feed-status';
import type { SearchArea } from '../lib/countries';
import { DEFAULT_SORT, type SortSpec } from '../lib/offer-sort';

// Requêtes de l'interface web. Règle d'or : CHAQUE requête filtre par userId,
// passé par le serveur à partir de la session — jamais par une valeur venant du navigateur.

// Statut d'une offre dans le fil = étape de la candidature liée, ou « à traiter » s'il n'y en a
// pas (cf. lib/status.ts). Toute requête du fil fait donc une jointure GAUCHE sur applications.
const applicationOfOffer = and(eq(applications.userId, userOffers.userId), eq(applications.offerId, userOffers.offerId));
const feedStatus = sql<FeedStatus>`coalesce(${applications.stage}::text, 'a_traiter')`;

// ─── Comptes ───
/**
 * Admet un utilisateur à la connexion :
 * - déjà inscrit → 'existing' (toujours accepté, même si le plafond est atteint) ;
 * - nouveau et places libres → inscrit, 'created' ;
 * - nouveau et plafond atteint → 'full', rien n'est créé.
 *
 * « Compter puis insérer » n'est pas atomique : deux inscriptions simultanées à 3/4 verraient
 * toutes deux une place libre et on finirait à 5. Le verrou consultatif (advisory lock) de
 * transaction sérialise les inscriptions : la 2e attend que la 1re ait fini, puis recompte.
 */
export async function admitUser(email: string, name: string | null, maxUsers: number): Promise<'existing' | 'created' | 'full'> {
  return db.transaction(async tx => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) return 'existing';

    await tx.execute(sql`select pg_advisory_xact_lock(${SIGNUP_LOCK_ID})`); // relâché au COMMIT
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if (n >= maxUsers) return 'full';

    await tx.insert(users).values({ email, name }).onConflictDoNothing();
    return 'created';
  });
}
const SIGNUP_LOCK_ID = 726_001; // identifiant arbitraire, propre à ce verrou

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
  maxExperienceYears: number | null; // null = pas de limite
  useAdzuna: boolean;
  contractTypes: string[];
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
export async function saveSheetId(userId: string, sheetId: string | null, sheetGid: number | null = null): Promise<void> {
  await db
    .insert(profiles)
    .values({ userId, sheetId, sheetGid })
    .onConflictDoUpdate({ target: profiles.userId, set: { sheetId, sheetGid, updatedAt: new Date() } });
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

/** Catalogue partagé, SANS les entreprises que l'utilisateur suit déjà (même ATS + identifiant). */
export async function listCatalog(userId: string) {
  return db
    .select({
      id: catalogCompanies.id,
      name: catalogCompanies.name,
      ats: catalogCompanies.ats,
      sector: catalogCompanies.sector,
      category: catalogCompanies.category,
      countries: catalogCompanies.countries,
      jobCount: catalogCompanies.jobCount,
    })
    .from(catalogCompanies)
    // Anti-jointure : LEFT JOIN puis « pas de correspondance » = pas encore suivie
    .leftJoin(companies, and(
      eq(companies.userId, userId),
      eq(companies.ats, catalogCompanies.ats),
      eq(companies.slug, catalogCompanies.slug),
    ))
    .where(isNull(companies.id))
    .orderBy(desc(catalogCompanies.jobCount));
}

/** Ajoute des entreprises du catalogue (déjà vérifiées : aucun appel aux ATS). Renvoie le nombre ajouté. */
export async function addCatalogCompanies(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const picked = await db.select().from(catalogCompanies).where(inArray(catalogCompanies.id, ids));
  if (picked.length === 0) return 0;
  const inserted = await db
    .insert(companies)
    .values(picked.map(c => ({ userId, name: c.name, ats: c.ats, slug: c.slug })))
    .onConflictDoNothing()
    .returning({ id: companies.id });
  return inserted.length;
}

export async function deleteCompany(userId: string, companyId: string): Promise<void> {
  // userId dans le WHERE : impossible de supprimer l'entreprise d'un autre utilisateur
  await db.delete(companies).where(and(eq(companies.id, companyId), eq(companies.userId, userId)));
}

// ─── Offres ───
/** Offres arrivées dans le fil depuis 24 h (retenues, non supprimées) : pastille de la navigation. */
export async function countNewOffers(userId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userOffers)
    .where(and(
      eq(userOffers.userId, userId),
      eq(userOffers.rejected, false),
      isNull(userOffers.dismissedAt),
      gte(userOffers.createdAt, sql`now() - interval '24 hours'`),
    ));
  return n;
}

// ─── Filtres du fil : tous CUMULABLES (ET entre familles, OU à l'intérieur d'une famille) ───
export interface FeedFilters {
  showRejected: boolean;
  dismissed?: boolean;           // vue Corbeille
  statuses?: FeedStatus[];
  countries?: string[];          // 'none' = pays non déterminé
  sources?: string[];
  minScore?: number;
  q?: string;                    // recherche dans l'intitulé et l'entreprise
  sinceDays?: number;            // arrivées dans le fil depuis N jours
}
type Facet = 'country' | 'status' | 'source';

/** Échappe %, _ et \ : une recherche « 100% » ne doit pas devenir un joker SQL. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Conditions du fil. `omit` retire UNE famille : pour compter les valeurs d'un filtre
 * (« France (12) »), on applique tous les AUTRES filtres mais pas celui-là — sinon, une fois
 * « France » coché, les autres pays afficheraient 0 et on ne pourrait plus les ajouter.
 */
function feedConditions(userId: string, f: FeedFilters, omit?: Facet) {
  const c = [eq(userOffers.userId, userId)];
  // Corbeille : seulement les supprimées ; sinon, jamais les supprimées
  c.push(f.dismissed ? isNotNull(userOffers.dismissedAt) : isNull(userOffers.dismissedAt));
  if (!f.showRejected) c.push(eq(userOffers.rejected, false));
  if (omit !== 'status' && f.statuses?.length) c.push(inArray(feedStatus, f.statuses));
  if (omit !== 'source' && f.sources?.length) c.push(inArray(offers.source, f.sources));
  if (omit !== 'country' && f.countries?.length) {
    const known = f.countries.filter(x => x !== 'none');
    const parts = [
      ...(known.length ? [inArray(offers.country, known)] : []),
      ...(f.countries.includes('none') ? [isNull(offers.country)] : []),
    ];
    c.push(parts.length === 1 ? parts[0] : or(...parts)!);
  }
  if (f.minScore !== undefined) c.push(gte(userOffers.score, f.minScore)); // les non notées sont exclues
  if (f.q) {
    const pattern = likePattern(f.q);
    c.push(or(ilike(offers.title, pattern), ilike(offers.company, pattern))!);
  }
  if (f.sinceDays) c.push(gte(userOffers.createdAt, sql`now() - make_interval(days => ${f.sinceDays})`));
  return c;
}

/** Compteurs par valeur pour chaque famille de filtres (« facettes »), cohérents avec le reste. */
export async function feedFacets(userId: string, f: FeedFilters) {
  const count = (col: typeof offers.country | typeof offers.source | typeof feedStatus, omit: Facet) =>
    db
      .select({ value: col, n: sql<number>`count(*)::int` })
      .from(userOffers)
      .innerJoin(offers, eq(offers.id, userOffers.offerId))
      .leftJoin(applications, applicationOfOffer)
      .where(and(...feedConditions(userId, f, omit)))
      .groupBy(col);
  const [byCountry, byStatus, bySource] = await Promise.all([
    count(offers.country, 'country'),
    count(feedStatus, 'status'),
    count(offers.source, 'source'),
  ]);
  const norm = (rows: { value: string | null; n: number }[]) =>
    rows.map(r => ({ value: r.value ?? 'none', n: r.n })).sort((a, b) => b.n - a.n);
  return { country: norm(byCountry), status: norm(byStatus), source: norm(bySource) };
}

// ─── Tri du fil (multi-critères) ───
// Les critères viennent de l'URL mais ont été validés par liste blanche (parseSort) : chaque clé
// correspond à une expression SQL écrite ICI, le sens n'est que asc/desc. Rien de l'URL n'est
// recopié tel quel dans la requête.

function sortExpr({ key, dir }: SortSpec) {
  const d = dir === 'asc' ? sql`asc` : sql`desc`;
  switch (key) {
    case 'recent': return sql`${userOffers.createdAt} ${d}`;
    // Sans note (mode sans clé) ou sans date : toujours en fin de liste, quel que soit le sens
    case 'score': return sql`${userOffers.score} ${d} nulls last`;
    // Date ISO AAAA-MM-JJ en texte : ordre alphabétique = ordre chronologique ; '' → NULL → en fin
    case 'posted': return sql`nullif(${offers.datePosted}, '') ${d} nulls last`;
    case 'company': return sql`lower(${offers.company}) ${d}`;
  }
}

export function orderFor(specs: SortSpec[]) {
  // Départages finaux, pour un ordre STABLE (sinon deux offres « égales » peuvent s'échanger
  // d'une page à l'autre) : arrivée dans le fil, puis identifiant.
  // Départage implicite par la note (ex. offres d'un même passage), sauf si la note est déjà un critère
  const byScore = specs.some(s => s.key === 'score') ? [] : [sql`${userOffers.score} desc nulls last`];
  return [...specs.map(sortExpr), ...byScore, desc(userOffers.createdAt), desc(offers.id)];
}

/** Taille d'une page du fil. */
export const PAGE_SIZE = 50;

/** Nombre total d'offres qui correspondent aux filtres (pour la pagination). */
export async function countOffers(userId: string, f: FeedFilters): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userOffers)
    .innerJoin(offers, eq(offers.id, userOffers.offerId))
    .leftJoin(applications, applicationOfOffer)
    .where(and(...feedConditions(userId, f)));
  return n;
}

export async function listOffers(userId: string, opts: FeedFilters & { sort?: SortSpec[]; page?: number }) {
  const conditions = feedConditions(userId, opts);

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
      employmentType: offers.employmentType,
      score: userOffers.score,
      verdict: userOffers.verdict,
      justification: userOffers.justification,
      strengths: userOffers.strengths,
      missingSkills: userOffers.missingSkills,
      status: feedStatus,
      rejected: userOffers.rejected,
      rejectReason: userOffers.rejectReason,
      requiredYears: userOffers.requiredYears,
      closedAt: offers.closedAt,
      addedAt: userOffers.createdAt, // date d'arrivée de l'offre dans le fil de CET utilisateur
    })
    .from(userOffers)
    .innerJoin(offers, eq(offers.id, userOffers.offerId))
    .leftJoin(applications, applicationOfOffer)
    .where(and(...conditions))
    .orderBy(...orderFor(opts.sort ?? DEFAULT_SORT))
    .limit(PAGE_SIZE)
    .offset(((opts.page ?? 1) - 1) * PAGE_SIZE);
}

/** Masque (dismissed = true) ou restaure des offres du fil — seulement les siennes. */
export async function setOffersDismissed(userId: string, offerIds: string[], dismissed: boolean): Promise<number> {
  if (offerIds.length === 0) return 0;
  const rows = await db
    .update(userOffers)
    .set({ dismissedAt: dismissed ? new Date() : null })
    .where(and(eq(userOffers.userId, userId), inArray(userOffers.offerId, offerIds)))
    .returning({ offerId: userOffers.offerId });
  return rows.length;
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
      status: feedStatus,
      dismissedAt: userOffers.dismissedAt,
      closedAt: offers.closedAt,
      coverLetter: userOffers.coverLetter,
    })
    .from(userOffers)
    .innerJoin(offers, eq(offers.id, userOffers.offerId))
    .leftJoin(applications, applicationOfOffer)
    .where(and(eq(userOffers.userId, userId), eq(userOffers.offerId, offerId)));
  return row;
}

/** Enregistre la lettre de motivation d'une offre — seulement dans SON fil. */
export async function setCoverLetter(userId: string, offerId: string, letter: string): Promise<boolean> {
  const rows = await db
    .update(userOffers)
    .set({ coverLetter: letter })
    .where(and(eq(userOffers.userId, userId), eq(userOffers.offerId, offerId)))
    .returning({ offerId: userOffers.offerId });
  return rows.length === 1;
}

/**
 * Signale une offre comme fermée (ou annule le signalement). L'offre est partagée : le
 * signalement l'écarte du fil de TOUS les utilisateurs qui l'ont encore « à traiter ».
 * Garde-fou : on ne peut signaler qu'une offre présente dans SON propre fil.
 */
export async function setOfferClosed(userId: string, offerId: string, closed: boolean): Promise<boolean> {
  return db.transaction(async tx => {
    const [own] = await tx
      .select({ offerId: userOffers.offerId })
      .from(userOffers)
      .where(and(eq(userOffers.userId, userId), eq(userOffers.offerId, offerId)));
    if (!own) return false;

    await tx.update(offers).set({ closedAt: closed ? new Date() : null }).where(eq(offers.id, offerId));
    // Effet immédiat sans attendre le prochain passage du worker (qui confirmera via reconcileFeed)
    await tx
      .update(userOffers)
      .set(closed ? { rejected: true, rejectReason: 'expired' } : { rejected: false, rejectReason: null })
      .where(and(
        eq(userOffers.offerId, offerId),
        noApplication,
        isNull(userOffers.dismissedAt),
        closed
          ? and(isNull(userOffers.rejectReason), eq(userOffers.rejected, false)) // seulement les offres retenues
          : eq(userOffers.rejectReason, 'expired'),                              // seulement celles écartées comme fermées
      ));
    return true;
  });
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

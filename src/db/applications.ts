import { and, asc, desc, eq, getTableColumns, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from './client';
import { applications, contacts, offers, profiles, userOffers } from './schema';
import {
  INTERVIEW_STAGES, RESPONSE_STAGES, companyKey, companyTypeFrom, contractFrom, mergeCategories, parseSheetDate, stageFromLabel, type Stage,
} from '../lib/applications';
import { fold } from '../lib/text';
import type { TrackedRow } from '../lib/sheets';
import type { CompanyToClassify } from '../lib/company-classifier';
import type { JobDetail, OfferScore } from '../lib/types';
import { requiredYears } from '../lib/experience';

// Requêtes de l'onglet « Candidatures ». Règle d'or inchangée : TOUT est filtré par userId.

const today = () => new Date().toISOString().slice(0, 10);
const contractOf = (employmentType: string) => {
  const t = employmentType.toLowerCase();
  if (/\bcdd\b|temporary/.test(t)) return 'CDD';
  if (/stage|intern/.test(t)) return 'Stage';
  if (/alternance|apprenti/.test(t)) return 'Alternance';
  if (/freelance|contract|indépendant/.test(t)) return 'Freelance';
  return 'CDI';
};

/**
 * Jalons à poser quand une candidature ARRIVE à une étape. Écrits en SQL avec coalesce :
 * une date déjà posée n'est jamais écrasée (la 1re réponse reste la 1re), et « interviewed »
 * ne repasse jamais à false. Ainsi revenir de « 3. In conversation » à « 6. Waiting » ne
 * fait pas disparaître l'entretien des statistiques.
 */
function milestones(stage: Stage) {
  return {
    ...(stage !== 'not_started' ? { appliedAt: sql`coalesce(${applications.appliedAt}, ${applications.lastContact}, current_date)` } : {}),
    ...(RESPONSE_STAGES.includes(stage) ? { respondedAt: sql`coalesce(${applications.respondedAt}, current_date)` } : {}),
    ...(INTERVIEW_STAGES.includes(stage) ? { interviewed: true } : {}),
  };
}

/** Mêmes jalons pour une ligne NEUVE (pas encore de valeur existante à préserver). */
function initialMilestones(stage: Stage, date: string | null) {
  return {
    appliedAt: stage !== 'not_started' ? date : null,
    respondedAt: RESPONSE_STAGES.includes(stage) ? date : null,
    interviewed: INTERVIEW_STAGES.includes(stage),
  };
}

export async function listApplications(userId: string) {
  return db
    .select({
      ...getTableColumns(applications),
      // Lettre rédigée pour l'offre liée : on l'indique dans le suivi (lien vers la fiche)
      hasLetter: sql<boolean>`coalesce(${userOffers.coverLetter} <> '', false)`,
    })
    .from(applications)
    .leftJoin(userOffers, and(eq(userOffers.userId, applications.userId), eq(userOffers.offerId, applications.offerId)))
    .where(eq(applications.userId, userId))
    .orderBy(sql`${applications.lastContact} desc nulls last`, desc(applications.createdAt));
}

/**
 * Statut choisi dans le fil → crée la candidature liée à l'offre, ou change son étape.
 * C'est la seule écriture : le fil lit ensuite l'étape de la candidature. Renvoie son id.
 */
export async function setOfferStage(userId: string, offerId: string, stage: Stage): Promise<string | null> {
  const [o] = await db
    .select({ company: offers.company, title: offers.title, url: offers.url, employmentType: offers.employmentType })
    .from(userOffers)
    .innerJoin(offers, eq(offers.id, userOffers.offerId))
    .where(and(eq(userOffers.userId, userId), eq(userOffers.offerId, offerId))); // seulement SES offres
  if (!o) return null;
  const [row] = await db.insert(applications)
    .values({ userId, offerId, company: o.company, title: o.title, url: o.url, origin: 'agent', contract: contractOf(o.employmentType), stage, lastContact: today(), ...initialMilestones(stage, today()) })
    .onConflictDoUpdate({ target: [applications.userId, applications.offerId], set: { stage, lastContact: today(), updatedAt: new Date(), ...milestones(stage) } })
    .returning({ id: applications.id });
  return row.id;
}

/** Ce qu'il faut pour écrire la ligne d'une candidature dans le Sheet — toujours filtré par userId. */
export async function getApplicationForSheet(userId: string, applicationId: string) {
  const [row] = await db
    .select({
      sheetId: profiles.sheetId,
      sheetGid: profiles.sheetGid,
      stage: applications.stage,
      company: applications.company,
      title: applications.title,
      url: applications.url,
      contract: applications.contract,
      // Offre liée (candidatures venues du fil) : lieu, source et note en plus
      location: sql<string>`coalesce(${offers.location}, '')`,
      source: sql<string>`coalesce(${offers.source}, ${applications.origin})`,
      score: userOffers.score,
    })
    .from(applications)
    .innerJoin(profiles, eq(profiles.userId, applications.userId))
    .leftJoin(offers, eq(offers.id, applications.offerId))
    .leftJoin(userOffers, and(eq(userOffers.userId, applications.userId), eq(userOffers.offerId, applications.offerId)))
    .where(and(eq(applications.userId, userId), eq(applications.id, applicationId)));
  return row;
}

export interface ApplicationInput {
  company: string; companyType: string; title: string; url: string; contract: string;
  stage: Stage; lastContact: string | null; notes: string;
}

export async function createApplication(userId: string, input: ApplicationInput): Promise<string> {
  const [row] = await db.insert(applications)
    .values({ userId, ...input, origin: 'manual', ...initialMilestones(input.stage, input.lastContact ?? today()) })
    .returning({ id: applications.id });
  return row.id;
}

export async function updateApplication(userId: string, id: string, patch: Partial<ApplicationInput>): Promise<boolean> {
  const rows = await db.update(applications).set({ ...patch, ...(patch.stage ? milestones(patch.stage) : {}), updatedAt: new Date() })
    .where(and(eq(applications.userId, userId), eq(applications.id, id))).returning({ id: applications.id });
  return rows.length === 1;
}

/**
 * Change l'étape de plusieurs candidatures en UNE requête. Les jalons suivent (date d'envoi,
 * 1re réponse, entretien), et « Last contact » passe à aujourd'hui si demandé.
 */
export async function updateStages(userId: string, ids: string[], stage: Stage, touchContact: boolean): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.update(applications)
    .set({ stage, ...milestones(stage), ...(touchContact ? { lastContact: today() } : {}), updatedAt: new Date() })
    .where(and(eq(applications.userId, userId), inArray(applications.id, ids)))
    .returning({ id: applications.id });
  return rows.length;
}

/**
 * Supprime une ou plusieurs candidatures. Une offre du fil liée à une candidature supprimée
 * redevient simplement « À traiter » (son statut EST la candidature).
 */
export async function deleteApplications(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const removed = await db.delete(applications)
    .where(and(eq(applications.userId, userId), inArray(applications.id, ids)))
    .returning({ id: applications.id });
  return removed.length;
}

// ─── Contacts ───

export interface ContactInput { company: string; name: string; role: string; email: string; linkedin: string; notes: string }

export async function listContacts(userId: string) {
  return db.select().from(contacts).where(eq(contacts.userId, userId)).orderBy(asc(contacts.company), asc(contacts.name));
}
export async function createContact(userId: string, input: ContactInput): Promise<void> {
  await db.insert(contacts).values({ userId, ...input });
}
export async function updateContact(userId: string, id: string, patch: Partial<ContactInput>): Promise<boolean> {
  const rows = await db.update(contacts).set(patch).where(and(eq(contacts.userId, userId), eq(contacts.id, id))).returning({ id: contacts.id });
  return rows.length === 1;
}
export async function deleteContact(userId: string, id: string): Promise<void> {
  await db.delete(contacts).where(and(eq(contacts.userId, userId), eq(contacts.id, id)));
}

// ─── Import depuis le Google Sheet ───

export interface SheetImportResult { added: number; duplicates: number; contacts: number }

const httpUrl = (u: string) => (/^https?:\/\//i.test(u) ? u.slice(0, 2000) : '');
const rowKey = (company: string, title: string) => `${companyKey(company)}|${fold(title).replace(/\s+/g, ' ').trim()}`;

/** « Marie Dupont (RH), jean@x.fr » → [{ name: 'Marie Dupont', role: 'RH' }, { name: 'jean', email: 'jean@x.fr' }] */
export function parseContactCell(cell: string): { name: string; role: string; email: string }[] {
  return cell.split(/[,;\n/]| et /).map(p => p.trim()).filter(p => p.length >= 2).slice(0, 5).map(p => {
    const email = /[^\s@()]+@[^\s@()]+\.[a-z]{2,}/i.exec(p)?.[0] ?? '';
    const role = /\(([^)]{1,80})\)/.exec(p)?.[1].trim() ?? '';
    const name = (p.replace(/\([^)]*\)/g, '').replace(email, '').trim() || email.split('@')[0]).slice(0, 120);
    return { name, role, email };
  }).filter(c => c.name.length >= 2);
}

/**
 * Importe les lignes du Sheet dans le suivi. Idempotent : une ligne déjà présente (même lien,
 * ou même entreprise + même poste) est ignorée, on peut donc relancer l'import sans doublon.
 * Si le lien est celui d'une offre connue de l'agent, la candidature y est rattachée.
 */
export async function importFromSheet(userId: string, rows: TrackedRow[], now = new Date()): Promise<SheetImportResult> {
  const existing = await db.select({ url: applications.url, company: applications.company, title: applications.title })
    .from(applications).where(eq(applications.userId, userId));
  const seenUrls = new Set(existing.map(e => e.url).filter(Boolean));
  const seenKeys = new Set(existing.map(e => rowKey(e.company, e.title)));

  const urls = [...new Set(rows.map(r => httpUrl(r.url)).filter(Boolean))];
  const known = urls.length ? await db.select({ id: offers.id, url: offers.url }).from(offers).where(inArray(offers.url, urls)) : [];
  const offerByUrl = new Map(known.map(o => [o.url, o.id]));

  const toInsert: (typeof applications.$inferInsert)[] = [];
  let duplicates = 0;
  for (const r of rows) {
    const url = httpUrl(r.url);
    const key = rowKey(r.company, r.title);
    if ((url && seenUrls.has(url)) || seenKeys.has(key)) { duplicates++; continue; }
    if (url) seenUrls.add(url);
    seenKeys.add(key);
    const stage = stageFromLabel(r.status) ?? 'applied';
    const day = parseSheetDate(r.date, now);
    toInsert.push({
      userId, offerId: url ? offerByUrl.get(url) ?? null : null, origin: 'sheet',
      company: r.company.slice(0, 120), companyType: companyTypeFrom(r.companyType), title: r.title.slice(0, 200), url,
      contract: contractFrom(r.contract), stage, lastContact: day, notes: r.notes.slice(0, 2000),
      ...initialMilestones(stage, day),
    });
  }

  // Contacts de la colonne « Contact » : rattachés à l'entreprise de la ligne, sans doublon
  const existingContacts = await db.select({ company: contacts.company, name: contacts.name }).from(contacts).where(eq(contacts.userId, userId));
  const seenContacts = new Set(existingContacts.map(c => `${companyKey(c.company)}|${fold(c.name)}`));
  const newContacts: (typeof contacts.$inferInsert)[] = [];
  for (const r of rows) {
    for (const c of parseContactCell(r.contact)) {
      const k = `${companyKey(r.company)}|${fold(c.name)}`;
      if (seenContacts.has(k)) continue;
      seenContacts.add(k);
      newContacts.push({ userId, company: r.company.slice(0, 120), ...c, notes: 'Importé du Google Sheet' });
    }
  }

  // Tout ou rien : un import à moitié fait serait pire qu'un import refusé
  return db.transaction(async tx => {
    const added = toInsert.length
      ? (await tx.insert(applications).values(toInsert).onConflictDoNothing().returning({ id: applications.id })).length
      : 0;
    if (newContacts.length) await tx.insert(contacts).values(newContacts);
    return { added, duplicates: duplicates + (toInsert.length - added), contacts: newContacts.length };
  });
}

// ─── Objectif hebdomadaire ───

export async function getWeeklyGoal(userId: string): Promise<number> {
  const [p] = await db.select({ goal: profiles.weeklyGoal }).from(profiles).where(eq(profiles.userId, userId));
  return p?.goal ?? 10;
}
export async function setWeeklyGoal(userId: string, goal: number): Promise<void> {
  await db.update(profiles).set({ weeklyGoal: goal }).where(eq(profiles.userId, userId));
}


export async function getSheetSettings(userId: string): Promise<{ sheetId: string | null; sheetGid: number | null }> {
  const [p] = await db.select({ sheetId: profiles.sheetId, sheetGid: profiles.sheetGid }).from(profiles).where(eq(profiles.userId, userId));
  return p ?? { sheetId: null, sheetGid: null };
}

// ─── Types d'entreprise (classement automatique) ───

/** Catégories de l'utilisateur : celles de base + toutes celles déjà utilisées dans son suivi. */
export async function listCategories(userId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ t: applications.companyType }).from(applications)
    .where(and(eq(applications.userId, userId), ne(applications.companyType, '')));
  return mergeCategories(rows.map(r => r.t).sort((a, b) => a.localeCompare(b, 'fr')));
}

/**
 * Entreprises sans type, regroupées par nom normalisé. Avant de solliciter Claude, on recopie
 * le type d'une autre candidature chez la MÊME entreprise s'il existe (gratuit et cohérent).
 * Renvoie ce qui reste à classer, avec des indices (postes, domaine du lien).
 */
export async function prepareUntyped(userId: string): Promise<CompanyToClassify[]> {
  const rows = await db.select({ id: applications.id, company: applications.company, companyType: applications.companyType, title: applications.title, url: applications.url })
    .from(applications).where(eq(applications.userId, userId));
  const typed = new Map<string, string>();
  for (const r of rows) if (r.companyType) typed.set(companyKey(r.company), r.companyType);

  const untyped = new Map<string, CompanyToClassify>();
  const copy = new Map<string, string[]>(); // type connu → ids à remplir
  for (const r of rows) {
    if (r.companyType) continue;
    const key = companyKey(r.company);
    const known = typed.get(key);
    if (known) { copy.set(known, [...(copy.get(known) ?? []), r.id]); continue; }
    const entry = untyped.get(key) ?? { name: r.company, hints: [] };
    let host = '';
    try { host = r.url ? new URL(r.url).hostname.replace(/^www\./, '') : ''; } catch {}
    for (const h of [r.title, host]) if (h && !entry.hints.includes(h)) entry.hints.push(h);
    untyped.set(key, entry);
  }
  for (const [type, ids] of copy) {
    await db.update(applications).set({ companyType: type })
      .where(and(eq(applications.userId, userId), inArray(applications.id, ids), eq(applications.companyType, '')));
  }
  return [...untyped.values()];
}

/**
 * Écrit les catégories trouvées. Ne remplit QUE les cases vides : un type choisi à la main par
 * l'utilisateur n'est jamais écrasé (même si une classification tardive arrive après son choix).
 */
export async function applyCompanyTypes(userId: string, types: Map<string, string>): Promise<number> {
  if (types.size === 0) return 0;
  const rows = await db.select({ id: applications.id, company: applications.company }).from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.companyType, '')));
  const byKey = new Map([...types].map(([name, t]) => [companyKey(name), t]));
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const t = byKey.get(companyKey(r.company));
    if (t) groups.set(t, [...(groups.get(t) ?? []), r.id]);
  }
  let n = 0;
  for (const [type, ids] of groups) {
    const done = await db.update(applications).set({ companyType: type, updatedAt: new Date() })
      .where(and(eq(applications.userId, userId), inArray(applications.id, ids), eq(applications.companyType, '')))
      .returning({ id: applications.id });
    n += done.length;
  }
  return n;
}

// ─── Analyse d'une candidature ajoutée à la main ───

const VERDICT_TO_DB = { 'Postuler': 'postuler', 'À étudier': 'a_etudier', 'Ignorer': 'ignorer' } as const;

/** Une candidature de l'utilisateur (seulement la sienne). */
export async function getApplication(userId: string, applicationId: string) {
  const [row] = await db.select().from(applications).where(and(eq(applications.userId, userId), eq(applications.id, applicationId)));
  return row;
}

/**
 * Donne une fiche d'offre à une candidature saisie à la main : l'offre (texte de l'annonce),
 * sa note pour CET utilisateur, puis le lien candidature → offre. La fiche de l'offre affiche
 * alors l'analyse de Claude et permet de rédiger la lettre, comme pour une offre du fil.
 *
 * L'offre est propre à la candidature (clé = lien + #job-agent-<id>) : le texte collé par un
 * utilisateur ne remplace jamais l'annonce qu'un autre voit pour le même lien.
 */
export async function attachOfferToApplication(
  userId: string,
  applicationId: string,
  job: JobDetail,
  scoring: OfferScore | null,
): Promise<string | null> {
  return db.transaction(async tx => {
    const [app] = await tx.select().from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.id, applicationId), isNull(applications.offerId)));
    if (!app) return null;
    const key = /^https?:\/\//i.test(app.url) ? `${app.url.split('#')[0]}#job-agent-${app.id}` : `manuel:${app.id}`;
    const [offer] = await tx.insert(offers).values({
      url: key,
      source: 'manual',
      title: job.title || app.title || 'Poste',
      company: app.company || job.company,
      location: job.location,
      salary: job.salary,
      employmentType: job.employmentType || app.contract,
      datePosted: job.datePosted,
      description: job.description,
      qualifications: job.qualifications,
      country: job.country ?? null,
    }).returning({ id: offers.id });
    await tx.insert(userOffers).values({
      userId,
      offerId: offer.id,
      score: scoring?.score ?? null,
      verdict: scoring ? VERDICT_TO_DB[scoring.verdict] : null,
      justification: scoring?.justification ?? '',
      strengths: scoring?.strengths ?? [],
      missingSkills: scoring?.missingSkills ?? [],
      requiredYears: requiredYears(job.title, job.description, job.qualifications),
    });
    await tx.update(applications).set({ offerId: offer.id, updatedAt: new Date() }).where(eq(applications.id, app.id));
    return offer.id;
  });
}

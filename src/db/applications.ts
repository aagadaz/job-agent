import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from './client';
import { applications, contacts, offers, profiles, userOffers } from './schema';
import {
  INTERVIEW_STAGES, RESPONSE_STAGES, STATUS_TO_STAGE, companyKey, companyTypeFrom, contractFrom, parseSheetDate, stageFromLabel, type Stage,
} from '../lib/applications';
import { fold } from '../lib/text';
import type { TrackedRow } from '../lib/sheets';
import type { ApplicationStatus } from '../lib/status';

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
  return db.select().from(applications).where(eq(applications.userId, userId))
    .orderBy(sql`${applications.lastContact} desc nulls last`, desc(applications.createdAt));
}

/**
 * Reprend dans le suivi les offres du fil déjà passées en « Postulé / Entretien / Refusé /
 * Abandonné » mais pas encore suivies (offres traitées avant l'existence de cet onglet).
 * Idempotent : la contrainte unique (user, offre) empêche tout doublon.
 */
export async function importFromFeed(userId: string): Promise<number> {
  const rows = await db
    .select({ offerId: offers.id, company: offers.company, title: offers.title, url: offers.url, employmentType: offers.employmentType, status: userOffers.status, createdAt: userOffers.createdAt })
    .from(userOffers)
    .innerJoin(offers, eq(offers.id, userOffers.offerId))
    .leftJoin(applications, and(eq(applications.userId, userId), eq(applications.offerId, offers.id)))
    .where(and(eq(userOffers.userId, userId), ne(userOffers.status, 'a_traiter'), isNull(applications.id)));
  if (rows.length === 0) return 0;
  const inserted = await db.insert(applications).values(rows.map(r => {
    const stage = STATUS_TO_STAGE[r.status] ?? 'applied';
    const day = r.createdAt.toISOString().slice(0, 10);
    return {
      userId, offerId: r.offerId, company: r.company, title: r.title, url: r.url, origin: 'agent',
      contract: contractOf(r.employmentType), stage, lastContact: day, ...initialMilestones(stage, day),
    };
  })).onConflictDoNothing().returning({ id: applications.id });
  return inserted.length;
}

/** Changement de statut dans le fil → crée ou met à jour la candidature liée. */
export async function syncFromOfferStatus(userId: string, offerId: string, status: ApplicationStatus): Promise<void> {
  const stage = STATUS_TO_STAGE[status];
  if (!stage) return; // « À traiter » : rien à suivre
  const [o] = await db.select().from(offers).where(eq(offers.id, offerId));
  if (!o) return;
  await db.insert(applications)
    .values({ userId, offerId, company: o.company, title: o.title, url: o.url, origin: 'agent', contract: contractOf(o.employmentType), stage, lastContact: today(), ...initialMilestones(stage, today()) })
    .onConflictDoUpdate({ target: [applications.userId, applications.offerId], set: { stage, lastContact: today(), updatedAt: new Date(), ...milestones(stage) } });
}

export interface ApplicationInput {
  company: string; companyType: string; title: string; url: string; contract: string;
  stage: Stage; lastContact: string | null; notes: string;
}

export async function createApplication(userId: string, input: ApplicationInput): Promise<void> {
  await db.insert(applications).values({ userId, ...input, origin: 'manual', ...initialMilestones(input.stage, input.lastContact ?? today()) });
}

export async function updateApplication(userId: string, id: string, patch: Partial<ApplicationInput>): Promise<boolean> {
  const rows = await db.update(applications).set({ ...patch, ...(patch.stage ? milestones(patch.stage) : {}), updatedAt: new Date() })
    .where(and(eq(applications.userId, userId), eq(applications.id, id))).returning({ id: applications.id });
  return rows.length === 1;
}

export async function deleteApplication(userId: string, id: string): Promise<void> {
  await db.delete(applications).where(and(eq(applications.userId, userId), eq(applications.id, id)));
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

/**
 * Rattrapage des jalons pour les lignes créées AVANT leur existence (idempotent, peu coûteux :
 * ne touche que les lignes où il manque quelque chose). Appelé à l'ouverture de l'onglet.
 */
export async function backfillMilestones(userId: string): Promise<void> {
  await db.execute(sql`
    update ${applications} set
      origin = case when origin = 'manual' and offer_id is not null then 'agent' else origin end,
      applied_at = case when stage <> 'not_started' then coalesce(applied_at, last_contact, created_at::date) else applied_at end,
      responded_at = case when stage in ('in_conversation', 'unsuccessful', 'committed') then coalesce(responded_at, last_contact, updated_at::date) else responded_at end,
      interviewed = interviewed or stage in ('in_conversation', 'committed')
    where user_id = ${userId} and (
      (origin = 'manual' and offer_id is not null)
      or (stage <> 'not_started' and applied_at is null)
      or (stage in ('in_conversation', 'unsuccessful', 'committed') and responded_at is null)
      or (stage in ('in_conversation', 'committed') and not interviewed)
    )`);
}

export async function getSheetSettings(userId: string): Promise<{ sheetId: string | null; sheetGid: number | null }> {
  const [p] = await db.select({ sheetId: profiles.sheetId, sheetGid: profiles.sheetGid }).from(profiles).where(eq(profiles.userId, userId));
  return p ?? { sheetId: null, sheetGid: null };
}

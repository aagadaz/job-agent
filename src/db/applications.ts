import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from './client';
import { applications, contacts, offers, userOffers } from './schema';
import { STATUS_TO_STAGE, type Stage } from '../lib/applications';
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
  const inserted = await db.insert(applications).values(rows.map(r => ({
    userId, offerId: r.offerId, company: r.company, title: r.title, url: r.url,
    contract: contractOf(r.employmentType), stage: STATUS_TO_STAGE[r.status] ?? 'applied',
    lastContact: r.createdAt.toISOString().slice(0, 10),
  }))).onConflictDoNothing().returning({ id: applications.id });
  return inserted.length;
}

/** Changement de statut dans le fil → crée ou met à jour la candidature liée. */
export async function syncFromOfferStatus(userId: string, offerId: string, status: ApplicationStatus): Promise<void> {
  const stage = STATUS_TO_STAGE[status];
  if (!stage) return; // « À traiter » : rien à suivre
  const [o] = await db.select().from(offers).where(eq(offers.id, offerId));
  if (!o) return;
  await db.insert(applications)
    .values({ userId, offerId, company: o.company, title: o.title, url: o.url, contract: contractOf(o.employmentType), stage, lastContact: today() })
    .onConflictDoUpdate({ target: [applications.userId, applications.offerId], set: { stage, lastContact: today(), updatedAt: new Date() } });
}

export interface ApplicationInput {
  company: string; companyType: string; title: string; url: string; contract: string;
  stage: Stage; lastContact: string | null; notes: string;
}

export async function createApplication(userId: string, input: ApplicationInput): Promise<void> {
  await db.insert(applications).values({ userId, ...input });
}

export async function updateApplication(userId: string, id: string, patch: Partial<ApplicationInput>): Promise<boolean> {
  const rows = await db.update(applications).set({ ...patch, updatedAt: new Date() })
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

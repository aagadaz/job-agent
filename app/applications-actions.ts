'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUserId } from '@/lib/session';
import { COMPANY_TYPES, CONTRACTS, STAGE_KEYS } from '@/lib/applications';
import {
  createApplication, createContact, deleteApplication, deleteContact, getSheetSettings, importFromSheet, setWeeklyGoal,
  updateApplication, updateContact,
} from '@/db/applications';
import { parseSheetGid, parseSheetId, readTrackingRows } from '@/lib/sheets';

// Server actions de l'onglet Candidatures. Comme partout : session revérifiée, chaque champ
// validé (zod), et l'identifiant de l'utilisateur imposé par le serveur dans chaque requête.

export interface ActionResult { ok: boolean; message: string }

const text = (max: number) => z.string().trim().max(max);
const url = z.string().trim().max(2000).refine(v => v === '' || /^https?:\/\//i.test(v), 'Le lien doit commencer par https://');

const ApplicationSchema = z.object({
  company: text(120).min(1, 'Indique l’entreprise.'),
  companyType: z.enum(['', ...COMPANY_TYPES]),
  title: text(200),
  url,
  contract: z.enum(CONTRACTS),
  stage: z.enum(STAGE_KEYS as [string, ...string[]]),
  lastContact: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  notes: text(2000),
});

const ContactSchema = z.object({
  company: text(120).min(1, 'Indique l’entreprise.'),
  name: text(120).min(1, 'Indique le nom du contact.'),
  role: text(120),
  email: z.string().trim().max(254).refine(v => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'E-mail invalide.'),
  linkedin: url,
  notes: text(1000),
});

const fromForm = (form: FormData, keys: string[]) =>
  Object.fromEntries(keys.map(k => [k, k === 'lastContact' ? (String(form.get(k) ?? '') || null) : String(form.get(k) ?? '')]));

export async function addApplication(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = ApplicationSchema.safeParse(fromForm(form, Object.keys(ApplicationSchema.shape)));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  await createApplication(userId, parsed.data as never);
  revalidatePath('/applications');
  return { ok: true, message: 'Candidature ajoutée.' };
}

/** Modification d'UN champ depuis le tableau (édition en ligne). */
export async function editApplication(id: string, field: string, value: string | null): Promise<ActionResult> {
  const userId = await requireUserId();
  const key = z.enum(Object.keys(ApplicationSchema.shape) as [string, ...string[]]).safeParse(field);
  const idOk = z.string().uuid().safeParse(id);
  if (!key.success || !idOk.success) return { ok: false, message: 'Modification invalide.' };
  const parsed = ApplicationSchema.shape[key.data as keyof typeof ApplicationSchema.shape].safeParse(value);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const ok = await updateApplication(userId, idOk.data, { [key.data]: parsed.data });
  revalidatePath('/applications');
  return ok ? { ok: true, message: '' } : { ok: false, message: 'Candidature introuvable.' };
}

export async function removeApplication(id: string): Promise<void> {
  const userId = await requireUserId();
  await deleteApplication(userId, z.string().uuid().parse(id));
  revalidatePath('/applications');
}

export async function addContact(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = ContactSchema.safeParse(fromForm(form, Object.keys(ContactSchema.shape)));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  await createContact(userId, parsed.data);
  revalidatePath('/applications');
  return { ok: true, message: 'Contact ajouté.' };
}

export async function editContact(id: string, field: string, value: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const key = z.enum(Object.keys(ContactSchema.shape) as [string, ...string[]]).safeParse(field);
  const idOk = z.string().uuid().safeParse(id);
  if (!key.success || !idOk.success) return { ok: false, message: 'Modification invalide.' };
  const parsed = ContactSchema.shape[key.data as keyof typeof ContactSchema.shape].safeParse(value);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const ok = await updateContact(userId, idOk.data, { [key.data]: parsed.data });
  revalidatePath('/applications');
  return ok ? { ok: true, message: '' } : { ok: false, message: 'Contact introuvable.' };
}

export async function removeContact(id: string): Promise<void> {
  const userId = await requireUserId();
  await deleteContact(userId, z.string().uuid().parse(id));
  revalidatePath('/applications');
}

// ─── Import depuis le Google Sheet ───

/**
 * Lit l'onglet de suivi et copie ses lignes dans l'onglet Candidatures. Sans URL saisie, on
 * prend le Sheet (et l'onglet) du Profil. Relançable sans risque : les doublons sont ignorés.
 */
export async function importSheet(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const raw = String(form.get('sheetUrl') ?? '').trim().slice(0, 500);
  const saved = await getSheetSettings(userId);
  const sheetId = raw ? parseSheetId(raw) : saved.sheetId;
  const gid = raw ? parseSheetGid(raw) : saved.sheetGid;
  if (!sheetId) {
    return { ok: false, message: raw ? "Ce n'est pas une URL de Google Sheet (docs.google.com/spreadsheets/d/…)." : 'Colle l’URL de l’onglet à importer (ou connecte ton Sheet dans le Profil).' };
  }
  try {
    const { tab, rows } = await readTrackingRows(sheetId, gid);
    const r = await importFromSheet(userId, rows);
    revalidatePath('/applications');
    const parts = [`${r.added} candidature${r.added > 1 ? 's' : ''} importée${r.added > 1 ? 's' : ''} depuis « ${tab} »`];
    if (r.duplicates) parts.push(`${r.duplicates} déjà présente${r.duplicates > 1 ? 's' : ''}`);
    if (r.contacts) parts.push(`${r.contacts} contact${r.contacts > 1 ? 's' : ''} ajouté${r.contacts > 1 ? 's' : ''}`);
    return { ok: true, message: `${parts.join(' · ')}.` };
  } catch (err) {
    console.error('Import Sheet :', err);
    const msg = err instanceof Error ? err.message : '';
    // Messages rédigés par nous (actionnables) : on les montre ; le reste reste dans les logs
    const actionable = /^(Sheet inaccessible|Ce fichier est un Excel|Onglet)/.test(msg);
    return { ok: false, message: actionable ? msg : 'Import impossible pour le moment (problème temporaire avec Google). Réessaie plus tard.' };
  }
}

export async function updateWeeklyGoal(value: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const goal = z.coerce.number().int().min(1, 'Au moins 1.').max(100, '100 au maximum.').safeParse(value.trim() === '' ? NaN : value);
  if (!goal.success) return { ok: false, message: goal.error.issues[0].message };
  await setWeeklyGoal(userId, goal.data);
  revalidatePath('/applications');
  return { ok: true, message: '' };
}

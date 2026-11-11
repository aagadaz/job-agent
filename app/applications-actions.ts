'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/session';
import { CONTRACTS, STAGES, STAGE_KEYS, type Stage } from '@/lib/applications';
import { classifyInBackground, classifyMissingTypes } from '@/lib/classify-runner';
import {
  createApplication, createContact, deleteApplications, deleteContact, updateStages, getSheetSettings, importFromSheet, setWeeklyGoal,
  updateApplication, updateContact, getApplication, attachOfferToApplication,
} from '@/db/applications';
import Anthropic from '@anthropic-ai/sdk';
import { getUserWithProfile } from '@/db/dashboard';
import { decrypt } from '@/lib/crypto';
import { FatalScoringError, scoreOffer } from '@/lib/scorer';
import { readJobPage } from '@/sources/website';
import type { JobDetail, OfferScore } from '@/lib/types';
import { parseSheetGid, parseSheetId, readTrackingRows } from '@/lib/sheets';
import { pushManyToSheet, pushToSheet } from '@/lib/sheet-sync';

// Server actions de l'onglet Candidatures. Comme partout : session revérifiée, chaque champ
// validé (zod), et l'identifiant de l'utilisateur imposé par le serveur dans chaque requête.

export interface ActionResult { ok: boolean; message: string }

const text = (max: number) => z.string().trim().max(max);
const url = z.string().trim().max(2000).refine(v => v === '' || /^https?:\/\//i.test(v), 'Le lien doit commencer par https://');

const ApplicationSchema = z.object({
  company: text(120).min(1, 'Indique l’entreprise.'),
  // Texte libre borné : les catégories de base + celles créées par Claude ou importées du Sheet
  companyType: text(40),
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
  const id = await createApplication(userId, parsed.data as never);
  // Type laissé vide → Claude le devine APRÈS la réponse (l'utilisateur n'attend pas)
  if (!parsed.data.companyType) after(() => classifyInBackground(userId));
  revalidatePath('/applications');
  const sheet = await pushToSheet(userId, id);
  if (!sheet.ok) return sheet;
  let message = `Candidature ajoutée.${sheet.message ? ` ${sheet.message}.` : ''}`;
  // Analyse demandée et possible (un lien ou le texte de l'annonce) : fiche, note et lettre
  const jobText = String(form.get('jobText') ?? '').trim();
  if (form.get('analyze') === 'on' && (parsed.data.url || jobText)) {
    const analysis = await analyzeApplication(id, jobText);
    message += analysis.ok
      ? ` ${analysis.message} Ouvre « Fiche de l’offre » sur la ligne pour voir la compatibilité et rédiger la lettre.`
      : ` ${analysis.message.replace('ci-dessous', 'avec le bouton « Analyser avec mon CV » de la ligne')}`;
  }
  return { ok: true, message };
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
  if (!ok) return { ok: false, message: 'Candidature introuvable.' };
  revalidatePath('/applications');
  revalidatePath('/offers'); // l'étape est aussi le statut affiché dans le fil
  // Changement d'étape (ou ajout du lien) → le Sheet suit, comme depuis le fil
  if (key.data === 'stage' || key.data === 'url') return pushToSheet(userId, idOk.data);
  return { ok: true, message: '' };
}

/** Changement d'étape de plusieurs lignes d'un coup (sélection dans le tableau). */
export async function changeStages(ids: string[], stage: string, touchContact: boolean): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = z.object({
    ids: z.array(z.string().uuid()).min(1).max(1000),
    stage: z.enum(STAGE_KEYS as [Stage, ...Stage[]]),
    touchContact: z.boolean(),
  }).safeParse({ ids, stage, touchContact });
  if (!parsed.success) return { ok: false, message: 'Sélection ou étape invalide.' };
  const unique = [...new Set(parsed.data.ids)];
  const n = await updateStages(userId, unique, parsed.data.stage, parsed.data.touchContact);
  after(() => pushManyToSheet(userId, unique)); // le Sheet suit, en arrière-plan
  revalidatePath('/applications');
  revalidatePath('/offers');
  return { ok: true, message: `${n} candidature${n > 1 ? 's' : ''} passée${n > 1 ? 's' : ''} en « ${STAGES[parsed.data.stage].label} ».` };
}

/** Suppression d'une ou plusieurs lignes du suivi (bouton de ligne ou sélection multiple). */
export async function removeApplications(ids: string[]): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = z.array(z.string().uuid()).min(1).max(1000).safeParse(ids);
  if (!parsed.success) return { ok: false, message: 'Sélection invalide.' };
  const n = await deleteApplications(userId, [...new Set(parsed.data)]);
  revalidatePath('/applications');
  revalidatePath('/offers'); // les offres liées redeviennent « À traiter »
  return { ok: true, message: `${n} candidature${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''}.` };
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
    if (r.added) after(() => classifyInBackground(userId));
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

// ─── Classement automatique des types d'entreprise ───

/** Bouton « Classer avec Claude » : classe tout de suite et renvoie un compte rendu. */
export async function autoClassify(): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const r = await classifyMissingTypes(userId);
    revalidatePath('/applications');
    if (r.status === 'no_key') return { ok: false, message: 'Ajoute ta clé Claude dans Profil pour classer automatiquement.' };
    if (r.status === 'nothing') return { ok: true, message: 'Toutes les entreprises ont déjà un type.' };
    const more = r.remaining ? ` Il en reste ${r.remaining} : relance.` : '';
    return { ok: true, message: `${r.classified} candidature${r.classified > 1 ? 's' : ''} classée${r.classified > 1 ? 's' : ''}.${more}` };
  } catch (err) {
    console.error('[company-types]', err instanceof Error ? err.message : err);
    const status = (err as { status?: number }).status;
    return {
      ok: false,
      message: status === 401 ? 'Ta clé Claude est refusée : vérifie-la dans Profil.'
        : status === 429 ? 'Limite de requêtes Claude atteinte : réessaie dans une minute.'
        : 'Classement impossible pour le moment. Réessaie plus tard.',
    };
  }
}

// ─── Analyse d'une candidature ajoutée à la main (compatibilité + lettre) ───

export interface AnalyzeResult { ok: boolean; message: string; offerId?: string; needText?: boolean }

const READ_ERRORS: Record<string, string> = {
  invalid: 'Ce lien n’est pas une adresse web publique.',
  excluded: 'LinkedIn et Indeed ne se laissent pas lire automatiquement.',
  robots: 'Ce site interdit la lecture automatique de ses pages.',
  blocked: 'Le site a bloqué la lecture automatique.',
  unreadable: 'Impossible de lire l’annonce sur cette page (vide, ou affichée par JavaScript).',
};
const MIN_PASTED = 150;
const MAX_PASTED = 15_000;

/**
 * Lit l'annonce (lien de la candidature, ou texte collé), la note avec le CV et la clé Claude
 * de l'utilisateur, puis la rattache à la candidature. Renvoie needText quand le lien ne se lit
 * pas : l'interface propose alors de coller le texte de l'annonce.
 */
export async function analyzeApplication(applicationId: string, pastedText = ''): Promise<AnalyzeResult> {
  const userId = await requireUserId();
  const id = z.string().uuid().safeParse(applicationId);
  if (!id.success) return { ok: false, message: 'Candidature invalide.' };
  const app = await getApplication(userId, id.data);
  if (!app) return { ok: false, message: 'Candidature introuvable.' };
  if (app.offerId) return { ok: true, message: '', offerId: app.offerId };

  // 1) Le texte de l'annonce : collé par l'utilisateur, sinon lu depuis le lien
  const pasted = String(pastedText).trim().slice(0, MAX_PASTED);
  let job: JobDetail;
  if (pasted) {
    if (pasted.length < MIN_PASTED) return { ok: false, needText: true, message: 'Colle le texte complet de l’annonce (missions, profil recherché).' };
    job = { title: app.title, company: app.company, location: '', description: pasted, qualifications: '', salary: '', employmentType: '', datePosted: '', url: app.url, source: 'manual' };
  } else if (app.url) {
    const read = await readJobPage(app.url);
    if (!read.ok) return { ok: false, needText: true, message: `${READ_ERRORS[read.reason]} Colle le texte de l’annonce ci-dessous.` };
    job = read.job;
  } else {
    return { ok: false, needText: true, message: 'Pas de lien pour cette candidature : colle le texte de l’annonce.' };
  }

  // 2) La note, si l'utilisateur a une clé Claude et un CV (sinon fiche sans note)
  const account = await getUserWithProfile(userId);
  const key = account?.user.anthropicKeyEncrypted;
  const cvText = account?.profile?.cvText;
  let scoring: OfferScore | null = null;
  let note = '';
  if (key && cvText) {
    try {
      scoring = await scoreOffer(new Anthropic({ apiKey: decrypt(key) }), cvText, { ...job, title: job.title || app.title, company: app.company || job.company });
      if (!scoring) note = ' La note n’a pas pu être calculée (réessaie plus tard).';
    } catch (err) {
      note = ` Note impossible : ${err instanceof FatalScoringError ? err.message : 'erreur Claude'}.`;
    }
  } else {
    note = ' Ajoute ta clé Claude et ton CV dans Profil pour obtenir la note de compatibilité.';
  }

  // 3) Rattachement
  const offerId = await attachOfferToApplication(userId, id.data, job, scoring);
  if (!offerId) return { ok: false, message: 'Candidature introuvable.' };
  revalidatePath('/applications');
  revalidatePath('/offers');
  return { ok: true, offerId, message: `Annonce analysée.${note}` };
}

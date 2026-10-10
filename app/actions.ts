'use server';

import Anthropic from '@anthropic-ai/sdk';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  STATUSES, createManualRun, deleteCompany, failRun, getApplicationForSheet, getUserWithProfile, insertCompany, saveEncryptedKey, saveProfile, saveSheetId, setOfferStatus,
} from '@/db/dashboard';
import { encrypt, maskSecret } from '@/lib/crypto';
import { extractPdfText } from '@/lib/cv-analyzer';
import { requireUserId } from '@/lib/session';
import { dispatchSearch, isGithubConfigured } from '@/lib/github';
import { getReconciledLastRun } from '@/lib/run-status';
import { ensureApplicationsTab, parseSheetId, syncApplication } from '@/lib/sheets';
import { mapPool } from '@/lib/concurrency';
import { readCompanyLines } from '@/lib/csv';
import { resolveCompany, SUPPORTED_ATS } from '@/sources/ats';

// Une server action est un endpoint HTTP public : on revérifie la session ET on valide
// chaque champ, même si le formulaire "ne permet pas" de l'envoyer autrement.

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** "a, b ,, c" → ["a", "b", "c"] */
const csv = z.string().transform(s => s.split(',').map(t => t.trim()).filter(Boolean));

const ProfileSchema = z.object({
  keywords: csv,
  location: z.string().trim().min(1, 'La localisation est obligatoire').max(100),
  includeTerms: csv,
  excludeTerms: csv,
  rejectThreshold: z.coerce.number().int().min(0).max(100),
  cvText: z.string().optional(),
});

const MAX_PDF_BYTES = 5 * 1024 * 1024;

export async function updateProfile(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const parsed = ProfileSchema.safeParse({
    keywords: form.get('keywords') ?? '',
    location: form.get('location') ?? '',
    includeTerms: form.get('includeTerms') ?? '',
    excludeTerms: form.get('excludeTerms') ?? '',
    rejectThreshold: form.get('rejectThreshold') ?? 35,
    cvText: (form.get('cvText') as string | null) || undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  let cvText = parsed.data.cvText?.trim() || undefined;
  const file = form.get('cvFile');
  if (file instanceof File && file.size > 0) {
    if (file.type !== 'application/pdf') return { ok: false, message: 'Le CV doit être un PDF.' };
    if (file.size > MAX_PDF_BYTES) return { ok: false, message: 'PDF trop lourd (5 Mo maximum).' };
    try {
      cvText = (await extractPdfText(new Uint8Array(await file.arrayBuffer()))).trim();
    } catch {
      return { ok: false, message: 'Impossible de lire ce PDF : colle plutôt le texte du CV.' };
    }
    if (!cvText) return { ok: false, message: "Ce PDF ne contient pas de texte (scan ?) : colle le texte du CV." };
  }

  await saveProfile(userId, { ...parsed.data, cvText });
  revalidatePath('/profile');
  return { ok: true, message: 'Profil enregistré.' };
}

export async function updateApiKey(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const key = String(form.get('apiKey') ?? '').trim();
  if (!key.startsWith('sk-ant-')) return { ok: false, message: 'Une clé Claude commence par sk-ant-.' };

  try {
    await new Anthropic({ apiKey: key }).models.list({ limit: 1 }); // appel gratuit qui valide la clé
  } catch {
    return { ok: false, message: 'Clé refusée par Anthropic : vérifie-la dans la console Claude.' };
  }

  await saveEncryptedKey(userId, encrypt(key));
  revalidatePath('/profile');
  return { ok: true, message: `Clé enregistrée (${maskSecret(key)}).` };
}

const CompanySchema = z.object({
  name: z.string().trim().min(1, "Le nom de l'entreprise est obligatoire").max(100),
  careersUrl: z.string().trim().max(500),
});

const RESOLVE_ERRORS = {
  invalid_url: `URL non reconnue. ATS pris en charge : ${SUPPORTED_ATS.join(', ')}.`,
  unreachable: "Le tableau d'offres ne répond pas à cette adresse : vérifie l'URL.",
  not_found: 'Aucun flux public trouvé. Colle l\'URL de sa page carrières (obligatoire pour Workday), sinon elle reste couverte par Adzuna.',
} as const;

export async function addCompany(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = CompanySchema.safeParse({
    name: form.get('name') ?? '',
    careersUrl: form.get('careersUrl') ?? '',
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { name, careersUrl } = parsed.data;

  const result = await resolveCompany(name, careersUrl);
  if (!result.ok) return { ok: false, message: `« ${name} » : ${RESOLVE_ERRORS[result.reason]}` };

  const added = await insertCompany(userId, { name, ats: result.ref.ats, slug: result.ref.slug });
  revalidatePath('/companies');
  if (!added) return { ok: true, message: `${name} est déjà dans ta liste.` };
  return { ok: true, message: `${name} ajoutée : ${result.ref.ats} (« ${result.ref.slug} »), ${result.jobCount} offres ouvertes.` };
}

// ─── Import d'un fichier d'entreprises ───
export interface ImportResult extends ActionResult {
  failed: { name: string; reason: string }[]; // lignes à corriger
  pending: string[];                          // non traitées faute de temps : relancer l'import
}

const IMPORT_MAX_BYTES = 200_000;
const IMPORT_MAX_LINES = 300;
const IMPORT_BUDGET_MS = 45_000; // sous la durée max de la fonction (60 s), avec une marge

export async function importCompanies(_prev: ImportResult | null, form: FormData): Promise<ImportResult> {
  const userId = await requireUserId();
  const empty = { failed: [], pending: [] };

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choisis un fichier .csv ou .txt.', ...empty };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, message: 'Fichier trop gros (200 Ko maximum).', ...empty };
  if (!/\.(csv|txt)$/i.test(file.name)) return { ok: false, message: 'Format attendu : .csv ou .txt (une entreprise par ligne).', ...empty };

  const lines = readCompanyLines(await file.text());
  if (lines.length === 0) return { ok: false, message: 'Aucune entreprise trouvée dans le fichier.', ...empty };
  if (lines.length > IMPORT_MAX_LINES) {
    return { ok: false, message: `${lines.length} lignes : ${IMPORT_MAX_LINES} maximum par import, découpe le fichier.`, ...empty };
  }

  const deadline = Date.now() + IMPORT_BUDGET_MS;
  let added = 0;
  let already = 0;
  const failed: ImportResult['failed'] = [];
  const pending: string[] = [];

  // Concurrence faible : une détection par nom interroge 6 ATS d'un coup, et certains
  // (Workable) renvoient HTTP 429 si on les sollicite trop vite.
  await mapPool(lines, 4, async line => {
    if (Date.now() > deadline) { pending.push(line.name); return; }
    const result = await resolveCompany(line.name, line.careersUrl).catch(() => null);
    if (!result) { failed.push({ name: line.name, reason: 'erreur réseau, réessaie' }); return; }
    if (!result.ok) { failed.push({ name: line.name, reason: RESOLVE_ERRORS[result.reason] }); return; }
    if (await insertCompany(userId, { name: line.name, ats: result.ref.ats, slug: result.ref.slug })) added++;
    else already++;
  });

  revalidatePath('/companies');
  const parts = [`${added} ajoutée${added > 1 ? 's' : ''}`];
  if (already) parts.push(`${already} déjà suivie${already > 1 ? 's' : ''}`);
  if (failed.length) parts.push(`${failed.length} non trouvée${failed.length > 1 ? 's' : ''}`);
  if (pending.length) parts.push(`${pending.length} non traitée${pending.length > 1 ? 's' : ''} (relance l'import : les déjà ajoutées seront ignorées)`);
  return { ok: added + already > 0, message: `Import terminé : ${parts.join(', ')}.`, failed, pending };
}

export async function removeCompany(companyId: string): Promise<void> {
  const userId = await requireUserId();
  await deleteCompany(userId, z.string().uuid().parse(companyId));
  revalidatePath('/companies');
}

export async function changeStatus(offerId: string, status: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = z.string().uuid().parse(offerId);
  const next = z.enum(STATUSES).parse(status);

  // 1) La base fait foi : le statut est enregistré quoi qu'il arrive ensuite
  await setOfferStatus(userId, id, next);
  revalidatePath('/offers');

  // 2) Le Sheet est une copie de confort : son échec ne doit pas annuler le changement de statut
  const app = await getApplicationForSheet(userId, id);
  if (!app?.sheetId) return { ok: true, message: '' };
  try {
    const result = await syncApplication(app.sheetId, next, app);
    return { ok: true, message: result === 'appended' ? 'Ajoutée au Sheet' : result === 'updated' ? 'Sheet mis à jour' : '' };
  } catch (err) {
    console.error('Synchro Sheet :', err);
    return { ok: false, message: `Statut enregistré, mais pas dans le Sheet : ${(err as Error).message}` };
  }
}

export async function updateSheet(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const raw = String(form.get('sheetUrl') ?? '').trim();

  if (!raw) {
    await saveSheetId(userId, null);
    revalidatePath('/profile');
    return { ok: true, message: 'Synchronisation Google Sheet désactivée.' };
  }

  const sheetId = parseSheetId(raw);
  if (!sheetId) return { ok: false, message: "Ce n'est pas une URL de Google Sheet (docs.google.com/spreadsheets/d/…)." };

  // On vérifie l'accès MAINTENANT (et on prépare l'onglet), plutôt qu'au premier « Postulé »
  try {
    await ensureApplicationsTab(sheetId);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  await saveSheetId(userId, sheetId);
  revalidatePath('/profile');
  return { ok: true, message: 'Sheet connecté : onglet « Candidatures » prêt.' };
}

// ─── Recherche manuelle ───
const COOLDOWN_MS = 10 * 60_000; // un lancement manuel toutes les 10 min au plus (après un succès)

export async function triggerSearch(_prev: ActionResult | null): Promise<ActionResult> {
  const userId = await requireUserId();

  // 1) Garde-fous AVANT de dépenser quoi que ce soit (minutes GitHub, crédits Claude)
  const row = await getUserWithProfile(userId);
  if (!row?.user.anthropicKeyEncrypted || !row.profile?.cvText) {
    return { ok: false, message: 'Complète ton profil (CV + clé Claude) avant de lancer une recherche.' };
  }
  if (!isGithubConfigured()) {
    return { ok: false, message: 'Lancement manuel non configuré (GITHUB_DISPATCH_TOKEN / GITHUB_REPO).' };
  }
  const previous = await getReconciledLastRun(userId); // état vérifié auprès de GitHub
  if (previous?.status === 'running') {
    return { ok: false, message: 'Une recherche est déjà en cours.' };
  }
  // Le délai ne s'applique qu'après une recherche RÉUSSIE : après un échec, on doit pouvoir
  // réessayer tout de suite une fois la cause corrigée.
  if (previous?.status === 'success') {
    const age = Date.now() - previous.startedAt.getTime();
    if (age < COOLDOWN_MS) {
      return { ok: false, message: `Dernière recherche trop récente : réessaie dans ${Math.ceil((COOLDOWN_MS - age) / 60_000)} min.` };
    }
  }

  // 2) La ligne "runs" est créée tout de suite : statut visible et anti double-clic immédiats
  const runId = await createManualRun(userId);

  // 3) Déclenchement du workflow
  const failure = await dispatchSearch(userId, runId);
  if (failure) {
    await failRun(userId, runId, `Lancement manuel impossible : ${failure}`);
    revalidatePath('/offers');
    return { ok: false, message: `Lancement impossible (${failure}).` };
  }

  revalidatePath('/offers');
  return { ok: true, message: 'Recherche lancée : 3 à 6 minutes. La page se mettra à jour toute seule.' };
}

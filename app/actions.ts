'use server';

import Anthropic from '@anthropic-ai/sdk';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import {
  createManualRun, deleteCompany, failRun, addCatalogCompanies, getOfferDetail, getUserWithProfile, setCoverLetter, insertCompany, listCompanies, saveEncryptedKey, saveProfile, saveSheetId, setOfferClosed, setOffersDismissed, setOffersFavorite,
} from '@/db/dashboard';
import { decrypt, encrypt, maskSecret } from '@/lib/crypto';
import { generateCoverLetter } from '@/lib/cover-letter';
import { getCvText } from '@/db/cvs';
import { requireUserId } from '@/lib/session';
import { NO_SEARCH_MESSAGE, searchMode } from '@/lib/search-mode';
import { dispatchSearch, isGithubConfigured } from '@/lib/github';
import { getReconciledLastRun } from '@/lib/run-status';
import { checkTrackingTab, parseSheetGid, parseSheetId } from '@/lib/sheets';
import { pushManyToSheet, pushToSheet } from '@/lib/sheet-sync';
import { STAGES, STAGE_KEYS, type Stage } from '@/lib/applications';
import { CONTRACTS } from '@/lib/contracts';
import { mapPool } from '@/lib/concurrency';
import { COUNTRY_CODES, type CountryCode } from '@/lib/countries';
import { readCompanyLines } from '@/lib/csv';
import { resolveCompany, SUPPORTED_ATS } from '@/sources/ats';
import { reconcileFeed } from '@/db/repository';
import { setOfferStage } from '@/db/applications';
import { classifyInBackground } from '@/lib/classify-runner';

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
  // Les zones arrivent en JSON (champ caché du formulaire) : on parse PUIS on valide la forme
  areas: z
    .string()
    .transform((s, ctx) => {
      try { return JSON.parse(s) as unknown; } catch { ctx.addIssue({ code: 'custom', message: 'Zones de recherche illisibles' }); return z.NEVER; }
    })
    .pipe(
      z.array(z.object({
        country: z.enum(COUNTRY_CODES as [CountryCode, ...CountryCode[]]),
        city: z.string().trim().max(60),
      })).min(1, 'Ajoute au moins une zone de recherche').max(6, '6 zones maximum'),
    ),
  includeTerms: csv,
  excludeTerms: csv,
  rejectThreshold: z.coerce.number().int().min(0).max(100),
  // Champ vide = pas de limite. Attention : z.coerce.number() transformerait "" en 0 (Number("") === 0) !
  useAdzuna: z.boolean(),
  contractTypes: z.array(z.enum(CONTRACTS)).max(CONTRACTS.length),
  maxExperienceYears: z
    .string()
    .trim()
    .transform(s => (s === '' ? null : Number(s)))
    .pipe(z.number().int('Nombre d\u2019années entier attendu').min(0).max(30).nullable()),
});

export async function updateProfile(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const parsed = ProfileSchema.safeParse({
    keywords: form.get('keywords') ?? '',
    areas: form.get('areas') ?? '[]',
    includeTerms: form.get('includeTerms') ?? '',
    excludeTerms: form.get('excludeTerms') ?? '',
    rejectThreshold: form.get('rejectThreshold') ?? 35,
    maxExperienceYears: form.get('maxExperienceYears') ?? '',
    // Case à cocher : présente dans le formulaire SEULEMENT si cochée (valeur "on")
    useAdzuna: form.get('useAdzuna') === 'on',
    contractTypes: [...new Set(form.getAll('contractTypes').map(String))],
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  // Le CV se gère dans la bibliothèque (cv-actions.ts) : le profil n'y touche plus
  // Le profil doit permettre AU MOINS un mode de recherche (cf. search-mode.ts)
  const current = await getUserWithProfile(userId);
  const mode = searchMode({
    hasKey: !!current?.user.anthropicKeyEncrypted,
    hasCv: !!current?.profile?.cvText,
    keywords: parsed.data.keywords,
  });
  if (!mode) return { ok: false, message: 'Sans clé Claude, indique au moins un mot-clé : ils ne peuvent pas être déduits du CV.' };

  // Sans Adzuna, les seules sources sont les pages carrières : il en faut au moins une
  if (!parsed.data.useAdzuna && (await listCompanies(userId)).length === 0) {
    return { ok: false, message: 'Sans Adzuna, ajoute d\u2019abord des entreprises (onglet Entreprises) : sinon la recherche ne trouvera rien.' };
  }

  await saveProfile(userId, parsed.data);
  // Application IMMÉDIATE des réglages au fil existant (Adzuna désactivé, limite d'expérience
  // modifiée) : même fonction que le worker, donc exactement les mêmes règles. Pas besoin
  // d'attendre la prochaine recherche.
  await reconcileFeed(userId, parsed.data.maxExperienceYears, parsed.data.useAdzuna ? [] : ['adzuna'], parsed.data.contractTypes);
  revalidatePath('/profile');
  revalidatePath('/offers');
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
  invalid_url: 'Adresse invalide : colle l\u2019URL complète de la page carrières (https://…).',
  unreachable: "Le tableau d'offres ne répond pas à cette adresse : vérifie l'URL.",
  not_found: 'Aucun flux public trouvé. Colle l\'URL de sa page carrières (obligatoire pour Workday, ou pour un site carrières maison).',
  excluded: 'Ce site est exclu de la collecte (LinkedIn, Indeed).',
  robots: 'Ce site interdit la lecture automatique (robots.txt) : on le respecte. Ses offres restent accessibles via les agrégateurs.',
  blocked: 'Ce site bloque les robots (protection anti-robots ou accès refusé) : on ne contourne pas ces protections.',
  no_structured_data: 'Page lisible, mais aucune offre au format standard (JobPosting) n\'y a été trouvée. Essaie l\'URL d\'une page d\'offre ou de la liste des offres.',
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

/** Ajoute en un clic des entreprises du catalogue partagé. */
export async function addFromCatalog(ids: string[]): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = z.array(z.string().uuid()).min(1, 'Aucune entreprise sélectionnée.').max(400).safeParse(ids);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const added = await addCatalogCompanies(userId, [...new Set(parsed.data)]);
  revalidatePath('/companies');
  return { ok: true, message: `${added} entreprise${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} : leurs offres arriveront à la prochaine recherche.` };
}

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

export async function dismissOffer(offerId: string, dismissed: boolean): Promise<void> {
  const userId = await requireUserId();
  await setOffersDismissed(userId, [z.string().uuid().parse(offerId)], z.boolean().parse(dismissed));
  revalidatePath('/offers');
}

/** Met une offre en favori (étoile), ou l'en retire. */
export async function favoriteOffer(offerId: string, favorite: boolean): Promise<void> {
  const userId = await requireUserId();
  await setOffersFavorite(userId, [z.string().uuid().parse(offerId)], z.boolean().parse(favorite));
  revalidatePath('/offers', 'layout'); // le fil et la fiche de l'offre
}

/** « Cette offre n'est plus disponible » (ou annulation si l'utilisateur s'est trompé). */
export async function reportClosed(offerId: string, closed: boolean): Promise<void> {
  const userId = await requireUserId();
  await setOfferClosed(userId, z.string().uuid().parse(offerId), z.boolean().parse(closed));
  revalidatePath('/offers');
}

const StageSchema = z.enum(STAGE_KEYS as [Stage, ...Stage[]]);

/**
 * Statut choisi dans le fil = étape de la candidature liée (créée si besoin). L'onglet
 * Candidatures et le Sheet lisent la même valeur : il n'y a qu'une source de vérité.
 */
export async function changeStatus(offerId: string, stage: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = z.string().uuid().parse(offerId);
  const next = StageSchema.parse(stage);

  // 1) La base fait foi : l'étape est enregistrée quoi qu'il arrive ensuite
  const applicationId = await setOfferStage(userId, id, next);
  if (!applicationId) return { ok: false, message: 'Offre introuvable.' };
  // Nouvelle candidature sans type d'entreprise → classement par Claude après la réponse
  after(() => classifyInBackground(userId));
  revalidatePath('/offers');
  revalidatePath('/applications');

  // 2) Le Sheet est une copie de confort : son échec ne doit pas annuler le changement
  return pushToSheet(userId, applicationId);
}

/**
 * Action groupée sur les offres cochées dans le fil : les écarter, les restaurer, ou leur
 * donner une étape. Le Sheet suit en arrière-plan (une écriture par offre, ça peut être long).
 */
export async function bulkOffers(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = z.object({
    ids: z.array(z.string().uuid()).min(1, 'Coche au moins une offre.').max(200),
    op: z.union([z.enum(['dismiss', 'restore', 'favorite', 'unfavorite']), StageSchema]),
  }).safeParse({ ids: form.getAll('ids').map(String), op: String(form.get('op') ?? '') });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const ids = [...new Set(parsed.data.ids)];
  const { op } = parsed.data;
  const plural = (n: number) => (n > 1 ? 's' : '');

  if (op === 'favorite' || op === 'unfavorite') {
    const n = await setOffersFavorite(userId, ids, op === 'favorite');
    revalidatePath('/offers');
    return { ok: true, message: `${n} offre${plural(n)} ${op === 'favorite' ? `ajoutée${plural(n)} aux` : `retirée${plural(n)} des`} favoris.` };
  }

  if (op === 'dismiss' || op === 'restore') {
    const n = await setOffersDismissed(userId, ids, op === 'dismiss');
    revalidatePath('/offers');
    return { ok: true, message: `${n} offre${plural(n)} ${op === 'dismiss' ? `mise${plural(n)} à la corbeille` : `restaurée${plural(n)}`}.` };
  }

  const applicationIds: string[] = [];
  for (const id of ids) {
    const appId = await setOfferStage(userId, id, op);
    if (appId) applicationIds.push(appId);
  }
  after(async () => {
    await pushManyToSheet(userId, applicationIds);
    await classifyInBackground(userId);
  });
  revalidatePath('/offers');
  revalidatePath('/applications');
  const n = applicationIds.length;
  return { ok: true, message: `${n} offre${plural(n)} passée${plural(n)} en « ${STAGES[op].label} ».` };
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

  // L'URL copiée depuis le navigateur désigne aussi l'onglet ouvert (#gid=…) : c'est celui-là
  // qu'on alimentera, dans son format. Sans gid → onglet « Candidatures » géré par l'application.
  const gid = parseSheetGid(raw);

  // On vérifie l'accès MAINTENANT (et la lisibilité de l'onglet), plutôt qu'à la première candidature envoyée
  let tab: string;
  try {
    tab = await checkTrackingTab(sheetId, gid);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  await saveSheetId(userId, sheetId, gid);
  revalidatePath('/profile');
  return { ok: true, message: `Sheet connecté : les candidatures iront dans l'onglet « ${tab} », à son format.` };
}

// ─── Recherche manuelle ───
const COOLDOWN_MS = 10 * 60_000; // un lancement manuel toutes les 10 min au plus (après un succès)

export async function triggerSearch(_prev: ActionResult | null): Promise<ActionResult> {
  const userId = await requireUserId();

  // 1) Garde-fous AVANT de dépenser quoi que ce soit (minutes GitHub, crédits Claude)
  const row = await getUserWithProfile(userId);
  const mode = searchMode({
    hasKey: !!row?.user.anthropicKeyEncrypted,
    hasCv: !!row?.profile?.cvText,
    keywords: row?.profile?.keywords ?? [],
  });
  if (!mode) return { ok: false, message: NO_SEARCH_MESSAGE };
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
    console.error('Lancement manuel :', failure); // le détail pour les logs Vercel, pas pour l'écran
    return { ok: false, message: "La recherche n'a pas pu être lancée. Réessaie dans quelques minutes." };
  }

  revalidatePath('/offers');
  return { ok: true, message: 'Recherche lancée : 3 à 6 minutes. La page se mettra à jour toute seule.' };
}

// ─── Lettre de motivation ───

const MAX_LETTER_CHARS = 5_000;

/** Génère (ou régénère) la lettre de motivation d'une offre avec la clé Claude de l'utilisateur. */
export async function createCoverLetter(offerId: string, note = '', cvId?: string): Promise<ActionResult & { letter: string }> {
  const userId = await requireUserId();
  const id = z.string().uuid().safeParse(offerId);
  if (!id.success) return { ok: false, message: 'Offre invalide.', letter: '' };
  const chosen = cvId ? z.string().uuid().safeParse(cvId) : null;
  if (chosen && !chosen.success) return { ok: false, message: 'CV invalide.', letter: '' };

  const [account, offer] = await Promise.all([getUserWithProfile(userId), getOfferDetail(userId, id.data)]);
  if (!offer) return { ok: false, message: 'Offre introuvable.', letter: '' };
  const encryptedKey = account?.user.anthropicKeyEncrypted;
  // CV choisi pour cette lettre (bibliothèque, seulement les siens), sinon celui qui note les offres
  const cvText = chosen?.success ? await getCvText(userId, chosen.data) : account?.profile?.cvText;
  if (!encryptedKey || !cvText) return { ok: false, message: 'Ajoute ta clé Claude et ton CV dans Profil.', letter: '' };

  let letter: string;
  try {
    letter = await generateCoverLetter(new Anthropic({ apiKey: decrypt(encryptedKey) }), cvText, offer, String(note).slice(0, 600));
  } catch (err) {
    // Détail technique dans les logs serveur uniquement ; message clair pour l'utilisateur
    console.error('[cover-letter]', err instanceof Error ? err.message : err);
    const status = (err as { status?: number }).status;
    const message =
      status === 401 ? 'Ta clé Claude est refusée : vérifie-la dans Profil.'
      : status === 402 || /credit/i.test(String((err as Error).message)) ? 'Crédit Claude épuisé sur ta clé.'
      : status === 429 || status === 529 ? 'Claude est très sollicité : réessaie dans une minute.'
      : 'La rédaction a échoué. Réessaie dans un instant.';
    return { ok: false, message, letter: '' };
  }

  await setCoverLetter(userId, id.data, letter.slice(0, MAX_LETTER_CHARS));
  return { ok: true, message: 'Lettre rédigée. Relis-la et personnalise-la avant de l\u2019envoyer.', letter };
}

/** Enregistre les retouches faites à la main sur la lettre. */
export async function saveCoverLetter(offerId: string, letter: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = z.object({ id: z.string().uuid(), letter: z.string().max(MAX_LETTER_CHARS, 'Lettre trop longue.') })
    .safeParse({ id: offerId, letter });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const ok = await setCoverLetter(userId, parsed.data.id, parsed.data.letter);
  return ok ? { ok: true, message: 'Modifications enregistrées.' } : { ok: false, message: 'Offre introuvable.' };
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUserId } from '@/lib/session';
import { extractPdfText } from '@/lib/cv-analyzer';
import { MAX_CVS, activateCv, countCvs, createCv, deleteCv, renameCv } from '@/db/cvs';

// Server actions de la bibliothèque de CV. Comme partout : session revérifiée, chaque champ
// validé, et l'identifiant de l'utilisateur imposé par le serveur dans chaque requête.

export interface CvActionResult { ok: boolean; message: string }

// Vercel refuse les requêtes de plus de 4,5 Mo : 4 Mo pour le PDF laisse la marge du formulaire
const MAX_CV_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 50_000;
const Name = z.string().trim().min(1, 'Donne un nom à ce CV (ex. « CV data FR »).').max(80, 'Nom trop long (80 caractères maximum).');
const Id = z.string().uuid();

const refresh = () => { revalidatePath('/profile'); revalidatePath('/offers', 'layout'); };

/** Ajout d'un CV : un PDF (texte extrait, fichier conservé) ou un texte collé. */
export async function addCv(_prev: CvActionResult | null, form: FormData): Promise<CvActionResult> {
  const userId = await requireUserId();
  const name = Name.safeParse(form.get('name') ?? '');
  if (!name.success) return { ok: false, message: name.error.issues[0].message };
  if ((await countCvs(userId)) >= MAX_CVS) return { ok: false, message: `${MAX_CVS} CV maximum : supprime-en un d'abord.` };

  const file = form.get('file');
  const pasted = String(form.get('text') ?? '').trim();
  let text = pasted;
  let fileName: string | null = null;
  let fileData: Buffer | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.type !== 'application/pdf') return { ok: false, message: 'Le CV doit être un PDF.' };
    if (file.size > MAX_CV_BYTES) return { ok: false, message: 'PDF trop lourd (4 Mo maximum).' };
    fileData = Buffer.from(await file.arrayBuffer());
    try {
      text = (await extractPdfText(fileData)).trim();
    } catch {
      return { ok: false, message: 'Impossible de lire ce PDF : colle plutôt le texte du CV.' };
    }
    if (!text) return { ok: false, message: 'Ce PDF ne contient pas de texte (scan ?) : colle le texte du CV.' };
    fileName = file.name.replace(/[^\w.\- ()À-ÿ]/g, '_').slice(0, 120) || 'cv.pdf';
  }
  if (!text) return { ok: false, message: 'Choisis un PDF ou colle le texte du CV.' };

  await createCv(userId, { name: name.data, text: text.slice(0, MAX_TEXT_CHARS), fileName, fileData });
  refresh();
  return { ok: true, message: 'CV ajouté.' };
}

export async function renameCvAction(cvId: string, name: string): Promise<CvActionResult> {
  const userId = await requireUserId();
  const parsed = z.object({ id: Id, name: Name }).safeParse({ id: cvId, name });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const ok = await renameCv(userId, parsed.data.id, parsed.data.name);
  refresh();
  return ok ? { ok: true, message: '' } : { ok: false, message: 'CV introuvable.' };
}

/** Choisit le CV qui note les offres (à la prochaine recherche) et rédige les lettres par défaut. */
export async function activateCvAction(cvId: string): Promise<CvActionResult> {
  const userId = await requireUserId();
  const ok = await activateCv(userId, Id.parse(cvId));
  refresh();
  return ok
    ? { ok: true, message: 'Ce CV notera les offres à partir de la prochaine recherche.' }
    : { ok: false, message: 'CV introuvable.' };
}

export async function deleteCvAction(cvId: string): Promise<CvActionResult> {
  const userId = await requireUserId();
  const result = await deleteCv(userId, Id.parse(cvId));
  refresh();
  if (result === 'active') return { ok: false, message: 'C’est le CV qui note tes offres : choisis-en d’abord un autre.' };
  return result === 'deleted' ? { ok: true, message: 'CV supprimé.' } : { ok: false, message: 'CV introuvable.' };
}

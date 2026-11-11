import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './client';
import { cvs, profiles } from './schema';

// Bibliothèque de CV. Règle d'or inchangée : TOUT est filtré par userId, passé par le serveur.
//
// Le CV « actif » (profiles.active_cv_id) est celui qui note les offres : son texte est recopié
// dans profiles.cv_text, le seul champ que lit le worker. Activer un CV = mettre à jour les deux.

export const MAX_CVS = 10;

/** Les CV de l'utilisateur, le plus récent d'abord, sans le fichier (lourd) : juste sa taille. */
export async function listCvs(userId: string) {
  return db
    .select({
      id: cvs.id,
      name: cvs.name,
      fileName: cvs.fileName,
      fileSize: cvs.fileSize,
      text: cvs.text,
      createdAt: cvs.createdAt,
      active: sql<boolean>`${cvs.id} = ${profiles.activeCvId}`,
    })
    .from(cvs)
    .leftJoin(profiles, eq(profiles.userId, cvs.userId))
    .where(eq(cvs.userId, userId))
    .orderBy(desc(cvs.createdAt));
}

export async function countCvs(userId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(cvs).where(eq(cvs.userId, userId));
  return n;
}

/** Fait de ce CV celui qui note les offres. Renvoie false si le CV n'est pas le sien. */
export async function activateCv(userId: string, cvId: string): Promise<boolean> {
  return db.transaction(async tx => {
    const [cv] = await tx.select({ text: cvs.text }).from(cvs).where(and(eq(cvs.userId, userId), eq(cvs.id, cvId)));
    if (!cv) return false;
    // Profil pas encore créé (nouveau compte) : on le crée avec ce CV
    await tx.insert(profiles)
      .values({ userId, cvText: cv.text, activeCvId: cvId })
      .onConflictDoUpdate({ target: profiles.userId, set: { cvText: cv.text, activeCvId: cvId, updatedAt: new Date() } });
    return true;
  });
}

export interface NewCv { name: string; text: string; fileName: string | null; fileData: Buffer | null }

/** Ajoute un CV. Le tout premier devient automatiquement le CV actif. Renvoie son id. */
export async function createCv(userId: string, input: NewCv): Promise<string> {
  const [row] = await db.insert(cvs)
    .values({ userId, ...input, fileSize: input.fileData?.length ?? null })
    .returning({ id: cvs.id });
  const [profile] = await db.select({ activeCvId: profiles.activeCvId }).from(profiles).where(eq(profiles.userId, userId));
  if (!profile?.activeCvId) await activateCv(userId, row.id);
  return row.id;
}

export async function renameCv(userId: string, cvId: string, name: string): Promise<boolean> {
  const rows = await db.update(cvs).set({ name, updatedAt: new Date() })
    .where(and(eq(cvs.userId, userId), eq(cvs.id, cvId))).returning({ id: cvs.id });
  return rows.length === 1;
}

/**
 * Supprime un CV. Le CV actif ne peut être supprimé que s'il est le dernier (sinon il faut d'abord
 * en activer un autre : on ne choisit pas à la place de l'utilisateur lequel note ses offres).
 */
export async function deleteCv(userId: string, cvId: string): Promise<'deleted' | 'active' | 'not_found'> {
  return db.transaction(async tx => {
    const [profile] = await tx.select({ activeCvId: profiles.activeCvId }).from(profiles).where(eq(profiles.userId, userId));
    const isActive = profile?.activeCvId === cvId;
    if (isActive) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(cvs).where(eq(cvs.userId, userId));
      if (n > 1) return 'active';
      // Dernier CV : le profil n'a plus de CV (notation impossible tant qu'un autre n'est pas ajouté)
      await tx.update(profiles).set({ cvText: null, activeCvId: null, updatedAt: new Date() }).where(eq(profiles.userId, userId));
    }
    const rows = await tx.delete(cvs).where(and(eq(cvs.userId, userId), eq(cvs.id, cvId))).returning({ id: cvs.id });
    return rows.length === 1 ? 'deleted' : 'not_found';
  });
}

/** Le fichier PDF d'un CV, seulement si c'est le sien. */
export async function getCvFile(userId: string, cvId: string) {
  const [row] = await db.select({ fileName: cvs.fileName, fileData: cvs.fileData })
    .from(cvs).where(and(eq(cvs.userId, userId), eq(cvs.id, cvId)));
  return row?.fileData ? { fileName: row.fileName ?? 'cv.pdf', data: row.fileData } : null;
}

/** Le texte d'un CV (lettre rédigée avec un autre CV que l'actif), seulement si c'est le sien. */
export async function getCvText(userId: string, cvId: string): Promise<string | null> {
  const [row] = await db.select({ text: cvs.text }).from(cvs).where(and(eq(cvs.userId, userId), eq(cvs.id, cvId)));
  return row?.text ?? null;
}

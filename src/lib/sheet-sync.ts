import { getApplicationForSheet } from '@/db/applications';
import { syncApplication } from './sheets';

// Report d'une candidature dans le Google Sheet de l'utilisateur. Module SERVEUR.
// Appelé après CHAQUE changement d'étape, d'où qu'il vienne (fil, onglet Candidatures,
// sélection multiple) : le Sheet suit la base, qui fait foi.

export interface SheetResult { ok: boolean; message: string }

/** Ne lève jamais : le Sheet est une copie de confort, son échec n'annule rien en base. */
export async function pushToSheet(userId: string, applicationId: string): Promise<SheetResult> {
  const app = await getApplicationForSheet(userId, applicationId);
  // Pas de Sheet connecté, ou pas de lien : impossible de retrouver la ligne sans risque
  if (!app?.sheetId || !app.url) return { ok: true, message: '' };
  try {
    const result = await syncApplication(app.sheetId, app.sheetGid, app.stage, app);
    return { ok: true, message: result === 'appended' ? 'Ajoutée au Sheet' : result === 'updated' ? 'Sheet mis à jour' : '' };
  } catch (err) {
    console.error('Synchro Sheet :', err);
    // Nos propres messages « actionnables » (partage manquant, fichier Excel) sont montrés tels quels ;
    // toute autre erreur (HTTP, réseau, jeton) reste dans les logs.
    const raw = (err as Error).message;
    const actionable = /^(Sheet inaccessible|Ce fichier est un Excel|Onglet)/.test(raw);
    return {
      ok: false,
      message: `Statut enregistré, mais pas dans le Sheet : ${actionable ? raw : 'réessaie plus tard (problème temporaire avec Google).'}`,
    };
  }
}

/** Plusieurs candidatures (sélection multiple), l'une après l'autre : à lancer en arrière-plan. */
export async function pushManyToSheet(userId: string, applicationIds: string[]): Promise<void> {
  for (const id of applicationIds) await pushToSheet(userId, id);
}

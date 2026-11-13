import { createManualRun, failRun, getUserWithProfile } from '../db/dashboard';
import { dispatchSearch, isGithubConfigured } from './github';
import { getReconciledLastRun } from './run-status';

/**
 * Lance la réanalyse des offres avec le CV de notation actuel (worker GitHub, MODE=rescore).
 * Module SERVEUR. Renvoie si elle est lancée et une phrase pour l'utilisateur (jamais
 * d'exception : le changement de CV est déjà enregistré, la réanalyse n'est qu'une suite).
 */
export async function startRescore(userId: string): Promise<{ started: boolean; message: string }> {
  const account = await getUserWithProfile(userId);
  if (!account?.user.anthropicKeyEncrypted) {
    return { started: false, message: 'Ajoute une clé Claude (Profil) pour que tes offres soient notées avec ce CV.' };
  }
  if (!account.profile?.cvText) return { started: false, message: '' };
  if (!isGithubConfigured()) return { started: false, message: 'La réanalyse automatique n’est pas configurée sur ce serveur.' };

  const previous = await getReconciledLastRun(userId);
  if (previous?.status === 'running') {
    return { started: false, message: 'Une recherche est déjà en cours : relance la réanalyse quand elle sera finie (bouton « Réanalyser mes offres »).' };
  }

  const runId = await createManualRun(userId, 'rescore');
  const failure = await dispatchSearch(userId, runId, 'rescore');
  if (failure) {
    await failRun(userId, runId, `Réanalyse impossible : ${failure}`);
    console.error('Réanalyse :', failure);
    return { started: false, message: 'La réanalyse n’a pas pu être lancée : réessaie avec le bouton « Réanalyser mes offres ».' };
  }
  return { started: true, message: 'Tes offres sont en cours de réanalyse avec ce CV (quelques minutes) : suis l’avancement dans Offres.' };
}

import { failRun, lastRun } from '../db/dashboard';
import { findManualRun, isGithubConfigured } from './github';

// Réconciliation : la base dit « en cours », mais est-ce encore vrai ?
// Le worker ne peut pas toujours clore sa ligne lui-même : s'il plante parce que la BASE
// est injoignable, il ne peut justement pas y écrire son échec. On demande donc à GitHub,
// qui connaît l'état réel du run, et on corrige la base si elle est en retard.

const GRACE_MS = 60_000;          // laisser au run le temps d'apparaître côté GitHub
const NEVER_STARTED_MS = 5 * 60_000; // introuvable après 5 min = jamais démarré
export const STALE_RUN_MS = 20 * 60_000; // filet ultime : timeout du job (15 min) + marge

export async function getReconciledLastRun(userId: string) {
  const run = await lastRun(userId);
  if (!run || run.status !== 'running') return run;

  const age = Date.now() - run.startedAt.getTime();
  let error: string | null = null;

  if (age > STALE_RUN_MS) {
    error = 'Recherche interrompue : aucun résultat reçu du worker.';
  } else if (age > GRACE_MS && isGithubConfigured()) {
    const gh = await findManualRun(run.id);
    if (gh?.status === 'completed' && gh.conclusion !== 'success') {
      error = `Le worker GitHub a échoué (${gh.conclusion}) : détails dans ${gh.url}`;
    } else if (gh?.status === 'completed') {
      error = 'Worker terminé sans enregistrer de résultat : détails dans ' + gh.url;
    } else if (!gh && age > NEVER_STARTED_MS) {
      error = 'Recherche interrompue : le workflow GitHub est introuvable.';
    }
  }

  if (!error) return run; // vraiment en cours
  await failRun(userId, run.id, error);
  return { ...run, status: 'error' as const, error, finishedAt: new Date() };
}

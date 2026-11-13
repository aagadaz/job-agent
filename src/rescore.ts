import Anthropic from '@anthropic-ai/sdk';
import { getActiveUsers, getOffersToRescore, saveRescores } from './db/repository';
import { getSettings } from './db/settings';
import { decrypt } from './lib/crypto';
import { scoreOffers } from './lib/scorer';
import type { JobDetail } from './lib/types';

/**
 * Réanalyse : re-note avec le CV ACTUEL les offres encore en jeu dans le fil d'un utilisateur.
 * Lancée quand il change de CV de notation (src/lib/rescore-trigger.ts → workflow GitHub,
 * MODE=rescore). Ne collecte aucune nouvelle offre : c'est le rôle de la recherche.
 */
export async function rescoreUser(userId: string): Promise<Record<string, number>> {
  const [entry] = await getActiveUsers(userId);
  const key = entry?.user.anthropicKeyEncrypted;
  const cvText = entry?.profile.cvText;
  if (!key || !cvText) throw new Error('Réanalyse impossible : il faut une clé Claude et un CV');

  const { maxScoredPerRun } = await getSettings();
  const rows = await getOffersToRescore(userId, maxScoredPerRun);
  console.log(`   ${rows.length} offres à réanalyser (plafond ${maxScoredPerRun})`);
  const jobs: (JobDetail & { offerId: string })[] = rows.map(r => ({ ...r, country: r.country ?? null }));

  // Une erreur « fatale » (clé refusée, crédit épuisé) remonte et fait échouer la réanalyse
  const scored = await scoreOffers(new Anthropic({ apiKey: decrypt(key) }), cvText, jobs);
  const withIds = scored.map((s, i) => ({ ...s, offerId: jobs[i].offerId }));
  const { kept, rejected } = await saveRescores(userId, withIds, entry.profile.rejectThreshold);
  const failed = scored.filter(s => s.scoring === null).length;

  // rescore = 1 : marqueur lu par l'interface pour afficher un message de réanalyse
  return { rescore: 1, rescored: kept + rejected, kept, rejected, scoreFailed: failed };
}

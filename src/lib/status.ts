// Statut d'une offre dans le fil. Module "pur" (aucun import serveur) : utilisable à la fois
// par les composants client (StatusSelect) et par le serveur.
//
// Il n'y a pas de statut stocké sur l'offre : « À traiter » = aucune candidature liée ; sinon,
// le statut EST l'étape de la candidature (table applications). Une seule source de vérité.

import { STAGES, STAGE_KEYS, type Stage } from './applications';

export type FeedStatus = 'a_traiter' | Stage;

export const FEED_STATUSES: readonly FeedStatus[] = ['a_traiter', ...STAGE_KEYS];

export const FEED_STATUS_LABELS: Record<FeedStatus, string> = {
  a_traiter: 'À traiter',
  ...(Object.fromEntries(STAGE_KEYS.map(k => [k, STAGES[k].label])) as Record<Stage, string>),
};

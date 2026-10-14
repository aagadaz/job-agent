// Traduction d'une exécution du worker en message lisible. Module PUR (aucun import serveur) :
// utilisé par la page (rendu serveur) ET par RunWatcher (navigateur), qui affichent le même texte.

export interface RunSnapshot {
  id: string;
  status: 'running' | 'success' | 'error';
  error: string | null;    // message POUR L'UTILISATEUR (déjà traduit côté serveur)
  details?: string | null; // erreur technique brute : seulement pour les administrateurs
  stats: { fetched?: number; new?: number; kept?: number; rejected?: number; unscored?: number; tooSenior?: number; expired?: number } | null;
}

export interface RunSummary {
  tone: 'success' | 'info' | 'error';
  text: string;
  details?: string | null;
}

// Singulier et pluriel fournis tous les deux : en français, plusieurs mots s'accordent
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function summarizeRun(run: RunSnapshot): RunSummary {
  const summary = baseSummary(run);
  // Complément : offres retirées du fil car disparues des sources (probablement pourvues)
  const expired = run.status === 'success' ? run.stats?.expired ?? 0 : 0;
  if (expired === 0) return summary;
  return { ...summary, text: `${summary.text} ${plural(expired, 'offre probablement fermée a été retirée', 'offres probablement fermées ont été retirées')} du fil.` };
}

function baseSummary(run: RunSnapshot): RunSummary {
  if (run.status === 'running') return { tone: 'info', text: 'Recherche en cours…' };
  if (run.status === 'error') {
    return { tone: 'error', text: run.error ?? 'La recherche a échoué.', details: run.details };
  }

  const fresh = run.stats?.new ?? 0;
  const kept = run.stats?.kept ?? 0;
  const rejected = run.stats?.rejected ?? 0;

  if (fresh === 0) {
    // On distingue les deux cas : rien trouvé du tout, ou que du déjà-vu
    return (run.stats?.fetched ?? 0) === 0
      ? { tone: 'info', text: 'Aucune offre trouvée par les sources. Élargis tes mots-clés ou ta localisation.' }
      : { tone: 'info', text: 'Aucune nouvelle offre : tout ce qui a été trouvé était déjà dans ta liste.' };
  }
  if (run.stats?.unscored) {
    return { tone: 'success', text: `${plural(fresh, 'nouvelle offre ajoutée', 'nouvelles offres ajoutées')} (non notées : ajoute une clé Claude dans Profil pour les noter).` };
  }
  if (kept === 0) {
    return { tone: 'info', text: `${plural(fresh, 'nouvelle offre', 'nouvelles offres')}, ${fresh > 1 ? 'toutes écartées' : 'écartée'} (note sous ton seuil ou trop d'expérience exigée).` };
  }
  return {
    tone: 'success',
    text: `${plural(kept, 'nouvelle offre retenue', 'nouvelles offres retenues')}${rejected ? ` (${plural(rejected, 'autre écartée', 'autres écartées')})` : ''}.`,
  };
}

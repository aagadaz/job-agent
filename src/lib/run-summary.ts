// Traduction d'une exécution du worker en message lisible. Module PUR (aucun import serveur) :
// utilisé par la page (rendu serveur) ET par RunWatcher (navigateur), qui affichent le même texte.

export interface RunSnapshot {
  id: string;
  status: 'running' | 'success' | 'error';
  error: string | null;
  stats: { fetched?: number; new?: number; kept?: number; rejected?: number } | null;
}

export interface RunSummary {
  tone: 'success' | 'info' | 'error';
  text: string;
}

// Singulier et pluriel fournis tous les deux : en français, plusieurs mots s'accordent
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function summarizeRun(run: RunSnapshot): RunSummary {
  if (run.status === 'running') return { tone: 'info', text: 'Recherche en cours…' };
  if (run.status === 'error') return { tone: 'error', text: `Échec : ${run.error ?? 'erreur inconnue'}` };

  const fresh = run.stats?.new ?? 0;
  const kept = run.stats?.kept ?? 0;
  const rejected = run.stats?.rejected ?? 0;

  if (fresh === 0) {
    // On distingue les deux cas : rien trouvé du tout, ou que du déjà-vu
    return (run.stats?.fetched ?? 0) === 0
      ? { tone: 'info', text: 'Aucune offre trouvée par les sources. Élargis tes mots-clés ou ta localisation.' }
      : { tone: 'info', text: 'Aucune nouvelle offre : tout ce qui a été trouvé était déjà dans ta liste.' };
  }
  if (kept === 0) {
    return { tone: 'info', text: `${plural(fresh, 'nouvelle offre', 'nouvelles offres')}, ${fresh > 1 ? 'toutes écartées' : 'écartée'} (score sous ton seuil).` };
  }
  return {
    tone: 'success',
    text: `${plural(kept, 'nouvelle offre retenue', 'nouvelles offres retenues')}${rejected ? ` (${plural(rejected, 'autre écartée', 'autres écartées')})` : ''}.`,
  };
}

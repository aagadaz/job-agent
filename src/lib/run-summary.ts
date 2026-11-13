// Traduction d'une exécution du worker en message lisible. Module PUR (aucun import serveur) :
// utilisé par la page (rendu serveur) ET par RunWatcher (navigateur), qui affichent le même texte.

export interface RunSnapshot {
  id: string;
  status: 'running' | 'success' | 'error';
  error: string | null;    // message POUR L'UTILISATEUR (déjà traduit côté serveur)
  details?: string | null; // erreur technique brute : seulement pour les administrateurs
  stats: { fetched?: number; new?: number; kept?: number; rejected?: number; unscored?: number; tooSenior?: number; expired?: number; scoreFailed?: number; rescore?: number; rescored?: number } | null;
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
  if (run.status !== 'success' || run.stats?.rescore) return summary;
  let text = summary.text;
  // Compléments : offres dont la notation a échoué (retentées), offres disparues des sources
  const failed = run.stats?.scoreFailed ?? 0;
  if (failed > 0) text += ` ${plural(failed, "offre n'a pas pu être notée", "offres n'ont pas pu être notées")} : nouvel essai à la prochaine recherche.`;
  const expired = run.stats?.expired ?? 0;
  if (expired > 0) text += ` ${plural(expired, 'offre probablement fermée a été retirée', 'offres probablement fermées ont été retirées')} du fil.`;
  return { ...summary, text };
}

function baseSummary(run: RunSnapshot): RunSummary {
  // Réanalyse après un changement de CV de notation (marqueur rescore dans les stats)
  if (run.stats?.rescore) {
    if (run.status === 'running') return { tone: 'info', text: 'Réanalyse de tes offres avec ton nouveau CV en cours…' };
    if (run.status === 'error') return { tone: 'error', text: run.error ?? 'La réanalyse a échoué.', details: run.details };
    const n = run.stats.rescored ?? 0;
    const failed = run.stats.scoreFailed ?? 0;
    if (n === 0 && failed === 0) return { tone: 'info', text: 'Réanalyse terminée : aucune offre à re-noter.' };
    return {
      tone: 'success',
      text: `${plural(n, 'offre réanalysée', 'offres réanalysées')} avec ton nouveau CV : ${plural(run.stats.kept ?? 0, 'retenue', 'retenues')}, ${plural(run.stats.rejected ?? 0, 'écartée', 'écartées')} (note sous ton seuil).`
        + (failed > 0 ? ` ${plural(failed, "n'a pas pu être notée", "n'ont pas pu être notées")} : elles gardent leur ancienne note.` : ''),
    };
  }
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
  // Toutes les nouvelles offres ont échoué à la notation : le complément ci-dessus l'explique
  if (kept === 0 && rejected === 0 && (run.stats?.scoreFailed ?? 0) > 0) {
    return { tone: 'info', text: 'Aucune nouvelle offre notée.' };
  }
  if (kept === 0) {
    return { tone: 'info', text: `${plural(fresh, 'nouvelle offre', 'nouvelles offres')}, ${fresh > 1 ? 'toutes écartées' : 'écartée'} (note sous ton seuil ou trop d'expérience exigée).` };
  }
  return {
    tone: 'success',
    text: `${plural(kept, 'nouvelle offre retenue', 'nouvelles offres retenues')}${rejected ? ` (${plural(rejected, 'autre écartée', 'autres écartées')})` : ''}.`,
  };
}

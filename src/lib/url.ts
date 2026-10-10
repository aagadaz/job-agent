// Paramètres de requête qui IDENTIFIENT une offre (à garder). Tous les autres sont du suivi
// (utm_*, source, ref…) et sont retirés. Liste blanche plutôt que liste noire : un paramètre
// de suivi inconnu ne doit pas faire passer une offre déjà vue pour une nouvelle (= re-notée).
// Exemple réel : Databricks et Squarepoint publient via Greenhouse sur leur propre site,
// toutes leurs offres ont la même adresse et ne diffèrent que par ?gh_jid=…
const IDENTIFYING_PARAMS = new Set(['gh_jid', 'jobid', 'job_id', 'jid', 'jk', 'id', 'oid', 'reqid', 'req_id', 'posting_id']);

/**
 * Normalise une URL pour qu'une même offre ait toujours la même clé :
 * on retire le fragment et les paramètres de suivi, on garde les paramètres identifiants (triés).
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const kept = [...u.searchParams]
      .filter(([key]) => IDENTIFYING_PARAMS.has(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = kept.length ? `?${new URLSearchParams(kept)}` : '';
    return `${u.origin}${u.pathname}`.replace(/\/$/, '') + query;
  } catch {
    return url.trim();
  }
}

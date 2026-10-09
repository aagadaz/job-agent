/**
 * Normalise une URL pour qu'une même offre ait toujours la même clé :
 * on retire la query string et le fragment (paramètres de tracking / de recherche).
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.origin}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}
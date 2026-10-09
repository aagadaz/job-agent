/** Normalise pour comparer : minuscules, sans accents. "Sénior" → "senior". */
export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Regex "mot entier" sûre à partir d'un terme saisi par un utilisateur. */
export function wordPattern(term: string): RegExp {
  const escaped = fold(term).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`);
}
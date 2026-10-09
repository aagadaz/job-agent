import type { JobDetail } from './types';

/** Normalise pour comparer : minuscules, sans accents. "Sénior" → "senior". */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Écarte les offres dont l'intitulé contient un terme exclu (ex. "senior", "lead").
 * Filtre déterministe et gratuit, appliqué AVANT le scoring payant.
 * Le terme doit être un mot entier : "lead" exclut "Tech Lead" mais pas "Leader".
 */
export function excludeByTitle(offers: JobDetail[], excludeTerms: string[]): JobDetail[] {
  const patterns = excludeTerms
    .map(t => fold(t).trim())
    .filter(Boolean)
    .map(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
  if (patterns.length === 0) return offers;
  return offers.filter(o => !patterns.some(p => p.test(fold(o.title))));
}
import type { JobDetail } from './types';
import { fold, wordPattern } from './text';
import { detectCountries, type CountryCode } from './countries';

/**
 * Écarte les offres dont l'intitulé contient un terme exclu (ex. "senior", "lead").
 * Le terme doit être un mot entier : "lead" exclut "Tech Lead" mais pas "Leader".
 */
export function excludeByTitle(offers: JobDetail[], excludeTerms: string[]): JobDetail[] {
  const patterns = excludeTerms.filter(t => t.trim()).map(wordPattern);
  if (patterns.length === 0) return offers;
  return offers.filter(o => !patterns.some(p => p.test(fold(o.title))));
}

/**
 * Ne garde que les offres dont l'intitulé contient AU MOINS un terme voulu (ex. "data", "ml").
 * Liste vide = pas de filtre. Indispensable pour les pages carrières, qui publient TOUS les postes.
 */
export function includeByTitle(offers: JobDetail[], includeTerms: string[]): JobDetail[] {
  const patterns = includeTerms.filter(t => t.trim()).map(wordPattern);
  if (patterns.length === 0) return offers;
  return offers.filter(o => patterns.some(p => p.test(fold(o.title))));
}

/**
 * Filtre géographique pour les pages carrières (une entreprise internationale publie
 * partout) : garde les offres situées dans un des pays voulus, et leur attribue ce pays.
 * Lieu vide : gardée, pays inconnu (le scoring tranchera). Non appliqué à Adzuna, dont
 * la recherche est déjà faite pays par pays.
 */
export function keepInCountries(offers: JobDetail[], wanted: CountryCode[]): JobDetail[] {
  return offers.flatMap<JobDetail>(o => {
    if (!o.location.trim()) return [{ ...o, country: null }];
    // Une offre multi-sites (« Paris | Luxembourg ») prend le premier pays VOULU qu'elle cite
    const country = detectCountries(o.location).find(c => wanted.includes(c));
    return country ? [{ ...o, country }] : [];
  });
}

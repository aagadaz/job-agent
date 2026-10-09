import type { JobDetail } from './types';
import { fold, wordPattern } from './text';

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
 * des postes partout). On garde : la ville voulue, la France, ou un lieu non renseigné
 * (le scoring tranchera). Non appliqué à Adzuna, déjà filtré par sa recherche.
 */
export function matchesLocation(offers: JobDetail[], wanted: string): JobDetail[] {
  const targets = [fold(wanted), 'france', 'ile-de-france'].filter(Boolean);
  return offers.filter(o => {
    const loc = fold(o.location);
    return loc === '' || targets.some(t => loc.includes(t));
  });
}
// Type de contrat d'une offre. Module PUR (aucun import serveur) : utilisé par le worker (filtre
// avant notation), le fil (tri réversible) et l'interface (pastille, cases du profil).

import { CONTRACTS } from './applications';
import { fold } from './text';

export type Contract = (typeof CONTRACTS)[number];
export { CONTRACTS };

/**
 * Déduit le contrat d'une offre de ce que dit la source (employmentType : « permanent »,
 * « CDD », « Internship », « Full-time »…) et de son intitulé (« Stage – Data Analyst »).
 * null = impossible à dire (beaucoup de pages carrières ne le précisent pas).
 *
 * L'intitulé passe en premier pour les contrats « spéciaux » : une offre « Alternance – Data »
 * publiée en « Full-time » reste une alternance.
 */
export function classifyContract(employmentType: string, title = ''): Contract | null {
  const t = fold(title);
  if (/\b(stage|stagiaire|intern|internship)\b/.test(t)) return 'Stage';
  if (/\b(alternance|alternant|apprenti|apprentissage|apprenticeship|work[- ]study|contrat pro(fessionnalisation)?)\b/.test(t)) return 'Alternance';
  if (/\b(v\.?i\.?e|volontariat international)\b/.test(t)) return 'VIE';
  if (/\b(freelance|independant)\b/.test(t)) return 'Freelance';

  const e = fold(employmentType);
  if (!e.trim()) return null;
  if (/\b(stage|intern|internship|trainee)\b/.test(e)) return 'Stage';
  if (/\b(alternance|apprenti|apprentissage|apprenticeship|professionnalisation)\b/.test(e)) return 'Alternance';
  if (/\b(v\.?i\.?e|volontariat)\b/.test(e)) return 'VIE';
  if (/\b(freelance|independant|liberale?|portage|contractor)\b/.test(e)) return 'Freelance';
  // France Travail écrit le contrat en toutes lettres (« indéterminée » contient « déterminée » :
  // on teste d'abord le CDI)
  if (/duree indeterminee/.test(e)) return 'CDI';
  if (/duree determinee/.test(e)) return 'CDD';
  // Adzuna : « contract » = durée déterminée ; France Travail : MIS (intérim), SAI (saisonnier)
  if (/\b(cdd|temporary|fixed[- ]term|contract|interim|mission|mis|saisonnier|sai|temporaire)\b/.test(e)) return 'CDD';
  if (/\b(cdi|permanent|regular|unbefristet)\b/.test(e)) return 'CDI';
  return null; // « Full-time », « Temps plein »… : la durée du travail, pas le contrat
}

/**
 * L'offre correspond-elle aux contrats voulus ? Liste vide = tous. Contrat inconnu = gardée :
 * l'écarter ferait perdre la plupart des offres des pages carrières, qui ne le précisent pas.
 */
export function contractWanted(contract: Contract | null, wanted: readonly string[]): boolean {
  return wanted.length === 0 || contract === null || wanted.includes(contract);
}

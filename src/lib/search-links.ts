/**
 * Liens de recherche pour retrouver une offre ailleurs que sur l'agrégateur (ex. quand la page
 * intermédiaire d'Adzuna bloque le navigateur). On ne contourne rien : on construit simplement
 * une recherche publique « intitulé + entreprise » que l'UTILISATEUR ouvre lui-même.
 */

// Sources dont le lien passe par une page intermédiaire (redirection + protection anti-robots)
export const REDIRECTING_SOURCES = new Set(['adzuna']);

export interface SearchLink { label: string; url: string }

export function offerSearchLinks(title: string, company: string, location?: string | null): SearchLink[] {
  // URLSearchParams encode tout (espaces, &, #, accents…) : un intitulé comme
  // « R&D Engineer #3 » ne peut ni casser l'URL ni y injecter un autre paramètre.
  const google = new URLSearchParams({ q: `"${title}" ${company}` });
  const linkedin = new URLSearchParams({ keywords: `${title} ${company}` });
  if (location) linkedin.set('location', location);
  return [
    { label: 'Google', url: `https://www.google.com/search?${google}` },
    { label: 'LinkedIn', url: `https://www.linkedin.com/jobs/search/?${linkedin}` },
  ];
}

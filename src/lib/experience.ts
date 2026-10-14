import { fold } from './text';

/**
 * Extrait le nombre MINIMUM d'années d'expérience exigé par une offre, ou null si le texte
 * n'en dit rien. Heuristique par expressions régulières, en français et en anglais :
 *   « 5+ years of experience », « 3-5 years experience », « 8 ans d'expérience »,
 *   « expérience de 5 ans minimum », « Expérience : 3 à 5 ans », « at least 7 years in … experience ».
 *
 * Choix de conception :
 *  - le mot « expérience » doit être PROCHE du nombre (même phrase, ≤ 40 caractères) :
 *    « Bac+5 », « 5 ans d'études » ou « fondée il y a 10 ans » ne comptent pas ;
 *  - une fourchette « 3-5 ans » vaut sa borne BASSE (le minimum exigé) ;
 *  - plusieurs mentions → on retient la plus PETITE : en cas de doute on garde l'offre
 *    (un faux rejet est pire qu'un faux positif, qu'on peut toujours écarter à la main) ;
 *  - valeurs > 15 ignorées : « 30 ans d'expérience » décrit l'entreprise, pas le poste.
 */
const YEARS = String.raw`(?:ans?|annees?|years?|yrs?)`;
const EXP = String.raw`(?:experience|xp)`;
const NUM = String.raw`(\d{1,2})\s*\+?\s*(?:(?:-|–|a|to|ou|or)\s*\d{1,2}\s*\+?\s*)?`;

const PATTERNS = [
  // nombre AVANT le mot : « 5+ years of (relevant professional) experience », « 3 à 5 ans d'expérience »
  new RegExp(String.raw`\b(?:plus de |over |more than |minimum |au moins |at least )?${NUM}${YEARS}\b[^.;\n]{0,40}?\b${EXP}`, 'g'),
  // nombre APRÈS le mot : « expérience de 5 ans minimum », « Experience: 3-5 years »
  new RegExp(String.raw`\b${EXP}\b[^.;\n\d]{0,30}?${NUM}${YEARS}\b`, 'g'),
];

export function requiredYears(...texts: (string | null | undefined)[]): number | null {
  const text = fold(texts.filter(Boolean).join('\n'));
  let min: number | null = null;
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      if (n <= 15 && (min === null || n < min)) min = n;
    }
  }
  return min;
}

/** L'offre exige-t-elle plus d'expérience que la limite de l'utilisateur ? (null = pas de limite) */
export function tooMuchExperience(years: number | null, maxYears: number | null): boolean {
  return maxYears !== null && years !== null && years > maxYears;
}

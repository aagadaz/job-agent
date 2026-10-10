import { fold } from './text';

// Pays pris en charge. Module PUR : utilisé par le worker, le serveur ET le navigateur
// (menu déroulant du profil, onglets de la page Offres).
//
// - adzuna : code du pays chez Adzuna (une base par pays), ou null s'il n'y en a pas.
// - names  : façons dont le pays apparaît dans un lieu d'offre (pays et grandes villes,
//            en français, anglais et langue locale). Comparés en mots entiers, sans accents.

export const COUNTRIES = {
  fr: { label: 'France', adzuna: 'fr', names: ['france', 'paris', 'ile-de-france', 'lyon', 'marseille', 'toulouse', 'nice', 'nantes', 'strasbourg', 'montpellier', 'bordeaux', 'lille', 'rennes', 'grenoble', 'sophia antipolis', 'la defense', 'boulogne-billancourt', 'issy-les-moulineaux', 'levallois-perret', 'puteaux', 'courbevoie', 'nanterre', 'massy', 'saclay', 'aix-en-provence', 'metz', 'nancy', 'reims', 'rouen', 'angers', 'tours', 'dijon', 'clermont-ferrand'] },
  lu: { label: 'Luxembourg', adzuna: null, names: ['luxembourg', 'luxemburg', 'esch-sur-alzette', 'belval', 'kirchberg', 'strassen', 'bertrange', 'leudelange', 'munsbach', 'capellen', 'howald', 'hesperange', 'differdange'] },
  be: { label: 'Belgique', adzuna: 'be', names: ['belgium', 'belgique', 'belgie', 'brussels', 'bruxelles', 'brussel', 'antwerp', 'anvers', 'antwerpen', 'ghent', 'gand', 'gent', 'liege', 'leuven', 'louvain', 'namur', 'charleroi', 'mons', 'wavre', 'mechelen'] },
  de: { label: 'Allemagne', adzuna: 'de', names: ['germany', 'allemagne', 'deutschland', 'berlin', 'munich', 'munchen', 'muenchen', 'hamburg', 'frankfurt', 'cologne', 'koln', 'stuttgart', 'dusseldorf', 'heidelberg', 'karlsruhe', 'leipzig', 'dresden', 'nuremberg', 'nurnberg', 'bonn', 'saarbrucken'] },
  ch: { label: 'Suisse', adzuna: 'ch', names: ['switzerland', 'suisse', 'schweiz', 'svizzera', 'zurich', 'geneva', 'geneve', 'genf', 'lausanne', 'basel', 'bale', 'bern', 'berne', 'lugano', 'zug'] },
  nl: { label: 'Pays-Bas', adzuna: 'nl', names: ['netherlands', 'pays-bas', 'nederland', 'holland', 'amsterdam', 'rotterdam', 'utrecht', 'eindhoven', 'the hague', 'den haag', 'la haye', 'delft', 'leiden'] },
  gb: { label: 'Royaume-Uni', adzuna: 'gb', names: ['united kingdom', 'royaume-uni', 'uk', 'england', 'scotland', 'london', 'londres', 'manchester', 'edinburgh', 'cambridge', 'oxford', 'bristol', 'glasgow', 'leeds', 'birmingham'] },
  es: { label: 'Espagne', adzuna: 'es', names: ['spain', 'espagne', 'espana', 'madrid', 'barcelona', 'barcelone', 'valencia', 'seville', 'sevilla', 'malaga', 'bilbao'] },
  it: { label: 'Italie', adzuna: 'it', names: ['italy', 'italie', 'italia', 'milan', 'milano', 'rome', 'roma', 'turin', 'torino', 'bologna', 'florence', 'firenze'] },
} as const;

export type CountryCode = keyof typeof COUNTRIES;
export const COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];

/** Une zone de recherche du profil : un pays, et éventuellement une ville (vide = tout le pays). */
export interface SearchArea {
  country: CountryCode;
  city: string;
}

export const isCountryCode = (s: string): s is CountryCode => s in COUNTRIES;
export const countryLabel = (code: string | null | undefined) =>
  code && isCountryCode(code) ? COUNTRIES[code].label : 'Non précisé';

// Une regex par pays, construite une seule fois : \b(paris|lyon|…)\b sur le texte "plié"
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = COUNTRY_CODES.map(code => ({
  code,
  re: new RegExp(`(^|[^a-z0-9])(${COUNTRIES[code].names.map(escape).join('|')})($|[^a-z0-9])`),
}));

/**
 * Pays mentionnés dans un lieu d'offre, dans l'ordre de la liste.
 * Reconnaît les noms (« Paris, France », « Remote - Belgium ») et les codes ISO isolés
 * en MAJUSCULES formant un segment (« FR, Paris » chez Workday). Les codes en minuscules
 * sont ignorés : « it » ou « be » sont des mots courants.
 */
export function detectCountries(location: string): CountryCode[] {
  const folded = fold(location);
  const found = new Set<CountryCode>(PATTERNS.filter(p => p.re.test(folded)).map(p => p.code));
  // Code ISO seulement s'il forme à lui seul un segment : « FR, Paris », « Kirchberg, LU ».
  // (« IT Department, Paris » ne doit pas devenir l'Italie.)
  for (const segment of location.split(/[,|/()]+/).map(s => s.trim())) {
    const lower = segment.toLowerCase();
    if (/^[A-Z]{2}$/.test(segment) && isCountryCode(lower)) found.add(lower);
  }
  return COUNTRY_CODES.filter(c => found.has(c));
}

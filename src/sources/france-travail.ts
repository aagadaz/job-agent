import type { JobDetail } from '../lib/types';

// Adapter France Travail (API « Offres d'emploi v2 ») : la plus large source d'offres en France,
// qui ne renvoie que des offres ACTIVES. Accès sur demande (francetravail.io) : sans identifiants
// configurés, la source est simplement ignorée.
//
// Authentification OAuth2 « client credentials » : l'application échange son identifiant et son
// secret contre un jeton d'accès de courte durée, puis l'envoie à chaque requête.

const TOKEN_URL = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const SEARCH_URL = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';
const SCOPE = 'api_offresdemploiv2 o2dsoffre';
const PAGE_SIZE = 150;      // maximum autorisé par l'API (range=0-149)
const PAGES_PER_KEYWORD = 2;
const MAX_DAYS_OLD = 7;     // même fenêtre que les autres agrégateurs

// Villes courantes → département (l'API filtre par code INSEE de commune ou par département)
const DEPARTEMENTS: Record<string, string> = {
  paris: '75', lyon: '69', marseille: '13', toulouse: '31', nantes: '44', bordeaux: '33', lille: '59',
  rennes: '35', nice: '06', strasbourg: '67', montpellier: '34', grenoble: '38', angers: '49',
  nanterre: '92', 'la defense': '92', 'boulogne-billancourt': '92', 'issy-les-moulineaux': '92',
  'levallois-perret': '92', 'saint-denis': '93', versailles: '78', massy: '91', 'sophia antipolis': '06',
};

export function isFranceTravailConfigured(): boolean {
  return !!(process.env.FRANCE_TRAVAIL_CLIENT_ID && process.env.FRANCE_TRAVAIL_CLIENT_SECRET);
}

let cached: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.FRANCE_TRAVAIL_CLIENT_ID!,
      client_secret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET!,
      scope: SCOPE,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  // Jamais le corps de la réponse dans l'erreur : il pourrait contenir des éléments sensibles
  if (!res.ok) throw new Error(`France Travail : authentification refusée (HTTP ${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

interface FtOffer {
  id: string;
  intitule: string;
  description?: string;
  dateCreation?: string;
  lieuTravail?: { libelle?: string };
  entreprise?: { nom?: string };
  typeContrat?: string;
  typeContratLibelle?: string;
  dureeTravailLibelle?: string;
  salaire?: { libelle?: string };
  experienceLibelle?: string;
  competences?: { libelle?: string }[];
  formations?: { niveauLibelle?: string; domaineLibelle?: string }[];
}

/** « 2026-10-26T00:00:00Z » : le format exact exigé par l'API (sans millisecondes). */
const ftDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

function toJobDetail(o: FtOffer): JobDetail {
  const qualifications = [
    o.experienceLibelle && `Expérience : ${o.experienceLibelle}`,
    o.formations?.length ? `Formation : ${o.formations.map(f => [f.niveauLibelle, f.domaineLibelle].filter(Boolean).join(' ')).join(' ; ')}` : '',
    o.competences?.length ? `Compétences : ${o.competences.map(c => c.libelle).filter(Boolean).join(', ')}` : '',
  ].filter(Boolean).join('\n');
  return {
    title: o.intitule,
    company: o.entreprise?.nom ?? 'Entreprise non communiquée',
    location: o.lieuTravail?.libelle ?? '',
    description: o.description ?? '',
    qualifications,
    salary: o.salaire?.libelle ?? 'Non précisé',
    employmentType: [o.typeContratLibelle ?? o.typeContrat, o.dureeTravailLibelle].filter(Boolean).join(', '),
    datePosted: o.dateCreation?.slice(0, 10) ?? '',
    // Page de l'offre sur francetravail.fr : stable, unique par offre, avec le bouton « Postuler »
    url: `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(o.id)}`,
    source: 'francetravail',
    country: 'fr',
  };
}

/** Offres actives publiées depuis MAX_DAYS_OLD jours, pour chaque mot-clé (et la ville si connue). */
export async function fetchFranceTravailOffers(keywords: string[], city: string): Promise<JobDetail[]> {
  const token = await getToken();
  const departement = DEPARTEMENTS[city.trim().toLowerCase()] ?? (/^\d{2}$/.test(city.trim()) ? city.trim() : undefined);
  const now = new Date();
  const since = new Date(now.getTime() - MAX_DAYS_OLD * 86_400_000);
  const out: JobDetail[] = [];

  for (const keyword of keywords) {
    for (let page = 0; page < PAGES_PER_KEYWORD; page++) {
      const params = new URLSearchParams({
        motsCles: keyword,
        range: `${page * PAGE_SIZE}-${page * PAGE_SIZE + PAGE_SIZE - 1}`,
        minCreationDate: ftDate(since),
        maxCreationDate: ftDate(now),
        ...(departement ? { departement } : {}),
      });
      const res = await fetch(`${SEARCH_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 204) break;                 // aucun résultat
      if (!res.ok) throw new Error(`France Travail : HTTP ${res.status}`);
      const data = (await res.json()) as { resultats?: FtOffer[] };
      const batch = data.resultats ?? [];
      out.push(...batch.map(toJobDetail));
      if (batch.length < PAGE_SIZE) break;           // dernière page (200 complet, 206 partiel)
    }
  }
  return out;
}

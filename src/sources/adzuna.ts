import type { JobDetail } from '../lib/types';

// Adapter Adzuna : traduit le format de l'API Adzuna vers notre modèle JobDetail.
// Le reste du pipeline (scoring, Sheet) ne sait pas d'où viennent les offres.

// Une base par pays : /jobs/fr/search, /jobs/be/search… (cf. COUNTRIES[x].adzuna)
const BASE_URL = 'https://api.adzuna.com/v1/api/jobs';
const RESULTS_PER_PAGE = 50;
const PAGES_PER_KEYWORD = 2;     // 2 x 50 = 100 offres max par mot-clé
const MAX_DAYS_OLD = 14;         // offres publiées depuis moins de 14 jours

// Forme (partielle) d'une offre renvoyée par Adzuna : on ne type que ce qu'on lit.
interface AdzunaJob {
  id: string;
  title: string;
  description: string;           // extrait tronqué, pas l'annonce complète
  created: string;               // date ISO de publication
  redirect_url: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;  // "1" si le salaire est estimé par Adzuna
  contract_type?: string;        // "permanent" | "contract"
  contract_time?: string;        // "full_time" | "part_time"
}

interface AdzunaResponse {
  count: number;
  results: AdzunaJob[];
}

export interface AdzunaSearchOptions {
  country: string;  // code Adzuna du pays (fr, be, de…)
  location: string; // ville, ou vide = tout le pays
}

function getCredentials(): { appId: string; appKey: string } {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    throw new Error('ADZUNA_APP_ID et ADZUNA_APP_KEY doivent être définis dans .env');
  }
  return { appId, appKey };
}

function formatSalary(job: AdzunaJob): string {
  if (!job.salary_min && !job.salary_max) return 'Non précisé';
  const fmt = (n?: number) => (n ? `${Math.round(n / 1000)}k€` : '?');
  const range = job.salary_min === job.salary_max
    ? fmt(job.salary_min)
    : `${fmt(job.salary_min)} - ${fmt(job.salary_max)}`;
  return job.salary_is_predicted === '1' ? `${range} (estimé)` : range;
}

function toJobDetail(job: AdzunaJob, country: string): JobDetail {
  return {
    title: job.title.replace(/<[^>]+>/g, ''), // Adzuna surligne parfois les mots-clés en <strong>
    description: job.description.replace(/<[^>]+>/g, ''),
    qualifications: '',                       // Adzuna ne sépare pas le profil recherché
    salary: formatSalary(job),
    employmentType: [job.contract_type, job.contract_time].filter(Boolean).join(', '),
    datePosted: job.created.slice(0, 10),
    company: job.company?.display_name ?? '',
    location: job.location?.display_name ?? '',
    url: job.redirect_url,
    source: 'adzuna',
    country, // la recherche était faite dans ce pays : pas besoin de le deviner
  };
}

async function fetchPage(keyword: string, page: number, opts: AdzunaSearchOptions): Promise<AdzunaJob[]> {
  const { appId, appKey } = getCredentials();
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    what: keyword,
    ...(opts.location ? { where: opts.location } : {}),
    results_per_page: String(RESULTS_PER_PAGE),
    max_days_old: String(MAX_DAYS_OLD),
    permanent: '1',
    sort_by: 'date',
  });

  const res = await fetch(`${BASE_URL}/${opts.country}/search/${page}?${params}`, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    // On ne journalise jamais l'URL complète : elle contient la clé d'API.
    const hint = res.status === 401 ? ' (identifiants Adzuna invalides ?)'
      : res.status === 429 ? ' (quota Adzuna dépassé)' : '';
    throw new Error(`Adzuna HTTP ${res.status}${hint} pour "${keyword}" page ${page}`);
  }

  const data = (await res.json()) as AdzunaResponse;
  return Array.isArray(data.results) ? data.results : [];
}

/** Récupère les offres Adzuna pour chaque mot-clé, dédupliquées par id Adzuna. */
export async function fetchAdzunaOffers(keywords: string[], opts: AdzunaSearchOptions): Promise<JobDetail[]> {
  const byId = new Map<string, AdzunaJob>();

  for (const keyword of keywords) {
    let found = 0;
    for (let page = 1; page <= PAGES_PER_KEYWORD; page++) {
      const jobs = await fetchPage(keyword, page, opts);
      jobs.forEach(j => byId.set(j.id, j));
      found += jobs.length;
      if (jobs.length < RESULTS_PER_PAGE) break; // dernière page atteinte
    }
    console.log(`🔎 [${opts.country}] "${keyword}" : ${found} offres`);
  }

  return [...byId.values()].map(j => toJobDetail(j, opts.country));
}
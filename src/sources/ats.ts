import type { JobDetail } from '../lib/types';
import { htmlToText } from '../lib/html';
import { fold } from '../lib/text';

// Adapter "pages carrières" : un module, sept ATS. Chaque fonction traduit le format
// de l'ATS vers notre JobDetail. Toutes ces API sont publiques, sans clé, et sont celles
// qu'appellent les pages carrières elles-mêmes dans ton navigateur.

export const SUPPORTED_ATS = [
  'greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'smartrecruiters', 'workday',
] as const;
export type Ats = (typeof SUPPORTED_ATS)[number];
export interface CompanyRef { name: string; ats: Ats; slug: string }

/** Options de collecte : les gros ATS (Workday, SmartRecruiters) sont interrogés par mot-clé. */
export interface FetchOptions {
  keywords?: string[];
  /** Plafond d'offres détaillées par entreprise (chaque détail = 1 requête HTTP). */
  maxJobs?: number;
}

const USER_AGENT = 'job-agent/1.0 (+https://github.com/aagadaz/job-agent)';
const DEFAULT_MAX_JOBS = 100;

/** Requête JSON ; renvoie null sur 404 (tableau d'offres inexistant), lève une erreur sinon. */
async function getJson<T>(url: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T | null> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000), // un ATS lent ne doit pas bloquer tout le worker
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${new URL(url).host}`);
  return (await res.json()) as T;
}

/**
 * Applique `fn` à chaque élément avec au plus `limit` appels simultanés.
 * Promise.all sur 100 URL ouvrirait 100 connexions d'un coup : impoli, et souvent bloqué (HTTP 429).
 */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++; // pas de course : JS est mono-thread, l'incrément est atomique entre deux await
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

const isoDay = (d?: string | number | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

// ─── Greenhouse ───
interface GreenhouseJob {
  title: string;
  absolute_url: string;
  updated_at?: string;
  location?: { name?: string };
  content?: string; // HTML encodé en entités : à décoder
}

async function fetchGreenhouse(c: CompanyRef): Promise<JobDetail[] | null> {
  const data = await getJson<{ jobs?: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.slug)}/jobs?content=true`,
  );
  if (!data || !Array.isArray(data.jobs)) return null;
  return data.jobs.map(j => ({
    title: j.title,
    company: c.name,
    location: j.location?.name ?? '',
    description: htmlToText(htmlToText(j.content ?? '')), // 1er passage : entités → HTML ; 2e : HTML → texte
    qualifications: '',
    salary: 'Non précisé',
    employmentType: '',
    datePosted: (j.updated_at ?? '').slice(0, 10),
    url: j.absolute_url,
    source: 'greenhouse',
  }));
}

// ─── Lever (deux régions : globale et Europe) ───
interface LeverPosting {
  text: string;
  hostedUrl: string;
  createdAt?: number; // millisecondes depuis 1970
  categories?: { location?: string; commitment?: string };
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
}

async function fetchLever(c: CompanyRef): Promise<JobDetail[] | null> {
  const slug = encodeURIComponent(c.slug);
  const data =
    (await getJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${slug}?mode=json`)) ??
    (await getJson<LeverPosting[]>(`https://api.eu.lever.co/v0/postings/${slug}?mode=json`));
  if (!Array.isArray(data)) return null;
  return data.map(p => ({
    title: p.text,
    company: c.name,
    location: p.categories?.location ?? '',
    description: [p.descriptionPlain ?? '', p.additionalPlain ?? ''].join('\n\n').trim(),
    // Les "lists" de Lever contiennent souvent le profil recherché : c'est notre champ qualifications
    qualifications: (p.lists ?? []).map(l => `${l.text}\n${htmlToText(l.content)}`).join('\n\n'),
    salary: 'Non précisé',
    employmentType: p.categories?.commitment ?? '',
    datePosted: isoDay(p.createdAt),
    url: p.hostedUrl,
    source: 'lever',
  }));
}

// ─── Ashby ───
interface AshbyJob {
  title: string;
  jobUrl: string;
  location?: string;
  isListed?: boolean;
  employmentType?: string;
  publishedAt?: string;
  descriptionPlain?: string;
}

async function fetchAshby(c: CompanyRef): Promise<JobDetail[] | null> {
  const data = await getJson<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.slug)}`,
  );
  if (!data || !Array.isArray(data.jobs)) return null;
  return data.jobs
    .filter(j => j.isListed !== false) // les offres non publiées sont exclues
    .map(j => ({
      title: j.title,
      company: c.name,
      location: j.location ?? '',
      description: j.descriptionPlain ?? '',
      qualifications: '',
      salary: 'Non précisé',
      employmentType: j.employmentType ?? '',
      datePosted: (j.publishedAt ?? '').slice(0, 10),
      url: j.jobUrl,
      source: 'ashby',
    }));
}

// ─── Workable (PME, scale-ups : Hugging Face…) ───
interface WorkableJob {
  title: string;
  url: string;
  employment_type?: string;
  published_on?: string;
  city?: string;
  country?: string;
  telecommuting?: boolean;
  description?: string; // HTML
}

async function fetchWorkable(c: CompanyRef): Promise<JobDetail[] | null> {
  const data = await getJson<{ jobs?: WorkableJob[] }>(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(c.slug)}?details=true`,
  );
  if (!data || !Array.isArray(data.jobs)) return null;
  return data.jobs.map(j => ({
    title: j.title,
    company: c.name,
    location: [j.city, j.country, j.telecommuting ? 'Remote' : ''].filter(Boolean).join(', '),
    description: htmlToText(j.description ?? ''),
    qualifications: '',
    salary: 'Non précisé',
    employmentType: j.employment_type ?? '',
    datePosted: j.published_on ?? '',
    url: j.url,
    source: 'workable',
  }));
}

// ─── Recruitee (très répandu chez les PME européennes) ───
interface RecruiteeOffer {
  title: string;
  careers_url: string;
  status?: string;
  location?: string;
  city?: string;
  country?: string;
  remote?: boolean;
  employment_type_code?: string;
  published_at?: string;
  description?: string; // HTML
  requirements?: string; // HTML
}

async function fetchRecruitee(c: CompanyRef): Promise<JobDetail[] | null> {
  // Le slug est le sous-domaine : https://<slug>.recruitee.com
  if (!/^[a-z0-9-]+$/i.test(c.slug)) return null; // il finit dans un nom d'hôte : on le valide
  const data = await getJson<{ offers?: RecruiteeOffer[] }>(`https://${c.slug}.recruitee.com/api/offers/`);
  if (!data || !Array.isArray(data.offers)) return null;
  return data.offers
    .filter(o => !o.status || o.status === 'published')
    .map(o => ({
      title: o.title,
      company: c.name,
      location: o.location || [o.city, o.country].filter(Boolean).join(', ') || (o.remote ? 'Remote' : ''),
      description: htmlToText(o.description ?? ''),
      qualifications: htmlToText(o.requirements ?? ''),
      salary: 'Non précisé',
      employmentType: o.employment_type_code ?? '',
      datePosted: (o.published_at ?? '').slice(0, 10),
      url: o.careers_url,
      source: 'recruitee',
    }));
}

// ─── SmartRecruiters (grands comptes : Bosch, Devoteam, Ubisoft, ServiceNow…) ───
interface SrListing {
  totalFound: number;
  content: { id: string }[];
}
interface SrPosting {
  name: string;
  postingUrl?: string;
  applyUrl?: string;
  releasedDate?: string;
  location?: { fullLocation?: string; city?: string; country?: string; remote?: boolean };
  typeOfEmployment?: { label?: string };
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
}

async function fetchSmartRecruiters(c: CompanyRef, opts: FetchOptions): Promise<JobDetail[] | null> {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.slug)}/postings`;
  const max = opts.maxJobs ?? DEFAULT_MAX_JOBS;

  // Plusieurs milliers d'offres chez certains : on cherche par mot-clé, on fusionne, on plafonne.
  const queries = opts.keywords?.length ? opts.keywords : [''];
  const ids = new Set<string>();
  let anyFound = false;
  for (const q of queries) {
    const list = await getJson<SrListing>(`${base}?limit=100&q=${encodeURIComponent(q)}`);
    if (!list) return null;
    if (list.totalFound > 0) anyFound = true;
    for (const p of list.content) ids.add(p.id);
  }
  // Piège : SmartRecruiters répond 200 + liste vide pour une entreprise INEXISTANTE.
  // Sans mots-clés (détection), « 0 offre » doit donc être lu comme « pas trouvée ».
  if (!anyFound && !opts.keywords?.length) return null;

  const details = await mapPool([...ids].slice(0, max), 5, id => getJson<SrPosting>(`${base}/${id}`));
  return details
    .filter((d): d is SrPosting => d !== null)
    .map(d => {
      const s = d.jobAd?.sections ?? {};
      return {
        title: d.name,
        company: c.name,
        location: d.location?.fullLocation ?? [d.location?.city, d.location?.country].filter(Boolean).join(', '),
        description: htmlToText(s.jobDescription?.text ?? ''),
        qualifications: htmlToText(s.qualifications?.text ?? ''),
        salary: 'Non précisé',
        employmentType: d.typeOfEmployment?.label ?? '',
        datePosted: (d.releasedDate ?? '').slice(0, 10),
        url: d.postingUrl ?? d.applyUrl ?? '',
        source: 'smartrecruiters',
      };
    })
    .filter(j => j.url);
}

// ─── Workday (grands groupes : BNP, Thales, Capgemini, NVIDIA…) ───
// Slug = "<tenant>.<wdN>/<site>", ex. "nvidia.wd5/NVIDIAExternalCareerSite",
// tiré de l'URL https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite
interface WdListing {
  total: number;
  jobPostings: { title: string; externalPath: string }[];
}
interface WdDetail {
  jobPostingInfo?: {
    title: string;
    jobDescription?: string; // HTML
    location?: string;
    additionalLocations?: string[];
    timeType?: string;
    startDate?: string;
    externalUrl?: string;
  };
}

function parseWorkdaySlug(slug: string) {
  const m = /^([a-z0-9-]+)\.(wd\d+)\/([\w-]+)$/i.exec(slug);
  if (!m) return null;
  const [, tenant, wd, site] = m;
  return { tenant, site, api: `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}` };
}

async function fetchWorkday(c: CompanyRef, opts: FetchOptions): Promise<JobDetail[] | null> {
  const wd = parseWorkdaySlug(c.slug);
  if (!wd) return null;
  const max = opts.maxJobs ?? DEFAULT_MAX_JOBS;
  const PAGE = 20; // Workday refuse limit > 20

  const queries = opts.keywords?.length ? opts.keywords : [''];
  const paths = new Set<string>();
  let reachable = false;
  for (const searchText of queries) {
    for (let offset = 0; offset < 60; offset += PAGE) { // 3 pages max par mot-clé
      const list = await getJson<WdListing>(`${wd.api}/jobs`, {
        method: 'POST',
        body: { appliedFacets: {}, limit: PAGE, offset, searchText },
      });
      if (!list) return null;
      reachable = true;
      list.jobPostings.forEach(j => paths.add(j.externalPath));
      // Au moins une page est toujours lue (c'est elle qui prouve que le site existe)
      if (offset + PAGE >= list.total || paths.size >= max) break;
    }
  }
  if (!reachable) return null;

  const details = await mapPool([...paths].slice(0, max), 5, p => getJson<WdDetail>(`${wd.api}${p}`));
  return details.flatMap(d => {
    const j = d?.jobPostingInfo;
    if (!j?.externalUrl) return [];
    return [{
      title: j.title,
      company: c.name,
      location: [j.location, ...(j.additionalLocations ?? [])].filter(Boolean).join(' | '),
      description: htmlToText(j.jobDescription ?? ''),
      qualifications: '',
      salary: 'Non précisé',
      employmentType: j.timeType ?? '',
      datePosted: j.startDate ?? '', // Workday n'expose qu'un texte relatif ("il y a 2 jours")
      url: j.externalUrl,
      source: 'workday',
    }];
  });
}

const FETCHERS: Record<Ats, (c: CompanyRef, opts: FetchOptions) => Promise<JobDetail[] | null>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workable: fetchWorkable,
  recruitee: fetchRecruitee,
  smartrecruiters: fetchSmartRecruiters,
  workday: fetchWorkday,
};

/** Type guard : l'ATS stocké en base a-t-il un adapter ? */
export function isSupportedAts(ats: string): ats is Ats {
  return (SUPPORTED_ATS as readonly string[]).includes(ats);
}

/** Toutes les offres publiées d'une entreprise. null = tableau introuvable chez cet ATS. */
export function fetchCompanyJobs(
  c: { name: string; ats: string; slug: string },
  opts: FetchOptions = {},
): Promise<JobDetail[] | null> {
  if (!isSupportedAts(c.ats)) {
    return Promise.reject(new Error(`ATS "${c.ats}" pas encore pris en charge`));
  }
  return FETCHERS[c.ats]({ ...c, ats: c.ats }, opts);
}

/**
 * Reconnaît l'ATS et l'identifiant à partir de l'URL d'une page carrières.
 * C'est la seule façon fiable pour Workday (le numéro wdN et le nom du site ne se devinent pas).
 */
export function parseCareersUrl(raw: string): { ats: Ats; slug: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  // Premier segment de chemin utile (on ignore les préfixes de langue Workday comme "fr-FR")
  const parts = u.pathname.split('/').filter(Boolean).filter(p => !/^[a-z]{2}-[A-Z]{2}$/.test(p));
  const first = parts[0];

  if (/(^|\.)greenhouse\.io$/.test(host) && first) {
    // boards.greenhouse.io/<slug> ou job-boards(.eu).greenhouse.io/<slug> ; embed : ?for=<slug>
    return { ats: 'greenhouse', slug: u.searchParams.get('for') ?? first };
  }
  if (/^jobs\.(eu\.)?lever\.co$/.test(host) && first) return { ats: 'lever', slug: first };
  if (host === 'jobs.ashbyhq.com' && first) return { ats: 'ashby', slug: first };
  if (host === 'apply.workable.com' && first && first !== 'j') return { ats: 'workable', slug: first };
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host) && first) return { ats: 'smartrecruiters', slug: first };

  const recruitee = /^([a-z0-9-]+)\.recruitee\.com$/.exec(host);
  if (recruitee) return { ats: 'recruitee', slug: recruitee[1] };

  const workday = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/.exec(host);
  if (workday && first) return { ats: 'workday', slug: `${workday[1]}.${workday[2]}/${first}` };

  return null;
}

/** Variantes de slug à essayer pour un nom : "Back Market" → backmarket, back-market. */
export function slugCandidates(name: string): string[] {
  const words = fold(name).split(/[^a-z0-9]+/).filter(Boolean);
  return [...new Set([words.join(''), words.join('-'), words.join('_')])].filter(Boolean);
}

/** ATS devinables à partir du seul nom (Workday exige l'URL, cf. parseCareersUrl). */
const GUESSABLE: Ats[] = ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'smartrecruiters'];

/** Détecte sur quel ATS une entreprise publie ses offres. Premier résultat trouvé. */
export async function detectAts(name: string): Promise<{ ref: CompanyRef; jobCount: number } | null> {
  for (const slug of slugCandidates(name)) {
    // Les ATS sont interrogés en parallèle pour un même slug, puis on garde le premier dans l'ordre.
    const attempts = await Promise.all(
      GUESSABLE.map(async ats => {
        const ref = { name, ats, slug };
        try {
          const jobs = await fetchCompanyJobs(ref, { maxJobs: 0 }); // détection : pas de détails
          return jobs ? { ref, jobCount: jobs.length } : null;
        } catch {
          return null; // erreur réseau ou format inattendu : combinaison suivante
        }
      }),
    );
    const hit = attempts.find(a => a !== null);
    if (hit) return hit;
  }
  return null;
}

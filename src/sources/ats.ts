import type { JobDetail } from '../lib/types';
import { htmlToText } from '../lib/html';
import { fold } from '../lib/text';

// Adapter "pages carrières" : un module, trois ATS. Chaque fonction traduit le format
// de l'ATS vers notre JobDetail. Toutes ces API sont publiques et sans clé.

export type Ats = 'greenhouse' | 'lever' | 'ashby';
export interface CompanyRef { name: string; ats: Ats; slug: string }

const USER_AGENT = 'job-agent/1.0 (+https://github.com/aagadaz/job-agent)';

/** GET JSON ; renvoie null sur 404 (tableau d'offres inexistant), lève une erreur sinon. */
async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${new URL(url).host}`);
  return (await res.json()) as T;
}

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
    datePosted: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : '',
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

const FETCHERS: Record<Ats, (c: CompanyRef) => Promise<JobDetail[] | null>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
};

/** Type guard : l'ATS stocké en base a-t-il un adapter ? (l'enum SQL en prévoit plus) */
export function isSupportedAts(ats: string): ats is Ats {
  return ats in FETCHERS;
}

/** Toutes les offres publiées d'une entreprise. null = tableau introuvable chez cet ATS. */
export function fetchCompanyJobs(c: { name: string; ats: string; slug: string }): Promise<JobDetail[] | null> {
  if (!isSupportedAts(c.ats)) {
    return Promise.reject(new Error(`ATS "${c.ats}" pas encore pris en charge`));
  }
  return FETCHERS[c.ats]({ ...c, ats: c.ats });
}

/** Variantes de slug à essayer pour un nom : "Back Market" → backmarket, back-market. */
export function slugCandidates(name: string): string[] {
  const words = fold(name).split(/[^a-z0-9]+/).filter(Boolean);
  return [...new Set([words.join(''), words.join('-'), words.join('_')])].filter(Boolean);
}

/** Détecte sur quel ATS une entreprise publie ses offres. Premier résultat trouvé. */
export async function detectAts(name: string): Promise<{ ref: CompanyRef; jobCount: number } | null> {
  for (const slug of slugCandidates(name)) {
    for (const ats of Object.keys(FETCHERS) as Ats[]) {
      const ref = { name, ats, slug };
      try {
        const jobs = await fetchCompanyJobs(ref);
        if (jobs) return { ref, jobCount: jobs.length };
      } catch {
        // Erreur réseau ou format inattendu : on essaie la combinaison suivante
      }
    }
  }
  return null;
}
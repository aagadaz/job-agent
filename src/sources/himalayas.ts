import type { JobDetail } from '../lib/types';
import type { CountryCode } from '../lib/countries';
import { htmlToText } from '../lib/html';

// Source « Himalayas » : offres en TÉLÉTRAVAIL, via l'API publique officielle
// (https://himalayas.app/api). Gratuite, sans clé obligatoire (une clé facultative,
// HIMALAYAS_API_KEY, relève les limites de débit).
//
// Conditions d'utilisation, respectées ici :
//  - lien vers Himalayas comme source : l'offre pointe vers sa page Himalayas (guid), et la
//    source s'affiche « Himalayas » dans le fil ;
//  - lien de candidature non modifié : on ne réécrit pas applicationLink (le bouton
//    « Postuler » est sur la page Himalayas) ;
//  - offres expirées retirées : on ignore celles dont expiryDate est passée, et le fil écarte
//    les offres anciennes comme pour les autres agrégateurs (src/db/repository.ts) ;
//  - pas de rediffusion vers d'autres sites d'emploi : la plateforme n'en fait aucune.

const SEARCH_URL = 'https://himalayas.app/jobs/api/search';
const USER_AGENT = 'job-agent/1.0 (+https://github.com/aagadaz/job-agent)';
const PAGE_SIZE = 20;            // taille fixe des pages de l'API
const PAGES_PER_QUERY = 3;       // 3 x 20 = 60 offres max par mot-clé et par pays
const MAX_DAYS_OLD = 14;         // mise à jour récente uniquement

interface HimalayasJob {
  title: string;
  excerpt?: string;
  companyName: string;
  employmentType?: string;       // « Full Time », « Contractor », « Intern »…
  seniority?: string[];
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string;
  currency?: string | null;
  locationRestrictions?: string[]; // vide = monde entier
  description?: string;            // HTML complet
  pubDate?: number;                // secondes (dernière mise à jour)
  expiryDate?: number;             // secondes
  applicationLink?: string;
  guid: string;                    // page de l'offre sur Himalayas : stable et unique
}

function salaryOf(j: HimalayasJob): string {
  if (j.minSalary == null && j.maxSalary == null) return 'Non précisé';
  const fmt = (n: number) => n.toLocaleString('fr-FR');
  const range = j.minSalary != null && j.maxSalary != null && j.minSalary !== j.maxSalary
    ? `${fmt(j.minSalary)} – ${fmt(j.maxSalary)}`
    : fmt((j.minSalary ?? j.maxSalary)!);
  const period = { annual: 'par an', monthly: 'par mois', weekly: 'par semaine', hourly: 'de l’heure' }[j.salaryPeriod ?? 'annual'] ?? '';
  return `${range} ${j.currency ?? ''} ${period}`.replace(/\s+/g, ' ').trim();
}

/** Lieu lisible : télétravail, et les pays acceptés (ou « monde entier »). */
function locationOf(j: HimalayasJob): string {
  const where = j.locationRestrictions ?? [];
  if (where.length === 0) return 'Télétravail (monde entier)';
  if (where.length > 4) return `Télétravail (${where.length} pays, dont ${where.slice(0, 3).join(', ')})`;
  return `Télétravail (${where.join(', ')})`;
}

function toJobDetail(j: HimalayasJob, country: CountryCode): JobDetail {
  return {
    title: j.title,
    company: j.companyName,
    location: locationOf(j),
    description: htmlToText(j.description ?? j.excerpt ?? ''),
    qualifications: j.seniority?.length ? `Niveau : ${j.seniority.join(', ')}` : '',
    salary: salaryOf(j),
    employmentType: j.employmentType ?? '',
    datePosted: j.pubDate ? new Date(j.pubDate * 1000).toISOString().slice(0, 10) : '',
    url: j.guid,
    source: 'himalayas',
    // Le pays de la recherche : l'API ne renvoie que les offres ouvertes à ce pays
    // (explicitement, ou parce qu'elles sont ouvertes au monde entier)
    country,
  };
}

async function fetchPage(keyword: string, country: CountryCode, page: number): Promise<HimalayasJob[]> {
  const params = new URLSearchParams({ q: keyword, country: country.toUpperCase(), sort: 'recent', page: String(page) });
  const key = process.env.HIMALAYAS_API_KEY?.trim();
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) throw new Error('Himalayas : limite de requêtes atteinte (HTTP 429)');
  if (!res.ok) throw new Error(`Himalayas : HTTP ${res.status}`);
  const data = (await res.json()) as { jobs?: HimalayasJob[] };
  return Array.isArray(data.jobs) ? data.jobs : [];
}

/**
 * Offres en télétravail ouvertes aux pays voulus, pour chaque mot-clé. Les plus récentes
 * d'abord ; on s'arrête dès qu'une page est incomplète ou trop ancienne.
 */
export async function fetchHimalayasOffers(keywords: string[], countries: CountryCode[]): Promise<JobDetail[]> {
  const now = Date.now() / 1000;
  const oldest = now - MAX_DAYS_OLD * 86_400;
  const byGuid = new Map<string, JobDetail>();

  for (const country of countries) {
    for (const keyword of keywords) {
      for (let page = 1; page <= PAGES_PER_QUERY; page++) {
        const jobs = await fetchPage(keyword, country, page);
        for (const j of jobs) {
          if (!j.guid || byGuid.has(j.guid)) continue;                 // déjà vue (autre page, autre mot-clé)
          if (j.expiryDate && j.expiryDate < now) continue;            // expirée
          if (j.pubDate && j.pubDate < oldest) continue;               // trop ancienne
          byGuid.set(j.guid, toJobDetail(j, country));
        }
        const tooOld = jobs.length > 0 && jobs.every(j => (j.pubDate ?? now) < oldest);
        if (jobs.length < PAGE_SIZE || tooOld) break;                 // dernière page utile
      }
    }
  }
  return [...byGuid.values()];
}

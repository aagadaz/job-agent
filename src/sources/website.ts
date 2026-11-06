import type { JobDetail } from '../lib/types';
import { htmlToText, decodeEntities } from '../lib/html';
import { xmlBlocks } from '../lib/xml';
import { normalizeUrl } from '../lib/url';

// Source « Site carrières » : lit les offres d'un site carrières quelconque (Taleo, SuccessFactors,
// site maison…) à partir des données structurées schema.org/JobPosting que ces sites publient
// EXPRÈS pour les moteurs de recherche (c'est ce qui alimente Google for Jobs).
//
// Règles de bonne conduite, non négociables :
//  - robots.txt respecté (RFC 9309) : une URL interdite n'est jamais demandée ;
//  - au plus une requête par seconde et par site (ou le Crawl-delay demandé, plafonné à 10 s) ;
//  - aucun contournement : un défi anti-robot, un CAPTCHA ou un 403 = on s'arrête là ;
//  - aucune connexion à un compte, aucun cookie ;
//  - un User-Agent qui dit qui nous sommes.

const USER_AGENT = 'job-agent/1.0 (+https://github.com/aagadaz/job-agent)';
const UA_TOKEN = 'job-agent';
const MAX_JOB_PAGES = 40;          // pages d'offres lues par site et par passage
const MAX_SITEMAPS = 6;
const DEFAULT_DELAY_MS = 1000;
const MAX_DELAY_MS = 10_000;
// Sites volontairement exclus (choix de l'utilisateur ; leurs conditions interdisent aussi la collecte)
const EXCLUDED_HOSTS = /(^|\.)(linkedin\.com|indeed\.[a-z.]+)$/i;
export const isExcludedHost = (host: string) => EXCLUDED_HOSTS.test(host);

// Chemins qui ressemblent à une offre (FR/EN)
const JOB_PATH = /\/(jobs?|offres?|emplois?|careers?|carrieres?|postes?|vacanc(y|ies)|positions?|opportunit(y|ies)|job-?details?|jobdetail|requisition)[/_-]?/i;

// ─── robots.txt ───

interface Rules { allow: string[]; disallow: string[]; delayMs: number; sitemaps: string[] }
const robotsCache = new Map<string, Promise<Rules | null>>();

/** Règles applicables à notre robot. null = robots.txt injoignable (5xx/réseau) → on n'explore PAS. */
function loadRobots(origin: string): Promise<Rules | null> {
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      let res: Response;
      try {
        res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000), redirect: 'follow' });
      } catch { return null; }
      // RFC 9309 : 4xx = pas de règles (tout est permis) ; 5xx = on suppose TOUT interdit
      if (res.status >= 500) return null;
      if (!res.ok) return { allow: [], disallow: [], delayMs: DEFAULT_DELAY_MS, sitemaps: [] };
      return parseRobots(await res.text());
    })());
  }
  return robotsCache.get(origin)!;
}

export function parseRobots(text: string): Rules {
  // Groupes « User-agent: … » suivis de règles. On prend le groupe le plus spécifique :
  // celui qui nomme notre robot, sinon celui de « * ».
  const groups: { agents: string[]; lines: [string, string][] }[] = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; lines: [string, string][] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'sitemap') { sitemaps.push(value); continue; }
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], lines: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current) current.lines.push([key, value]);
  }
  const mine = groups.find(g => g.agents.some(a => a !== '*' && UA_TOKEN.startsWith(a))) ?? groups.find(g => g.agents.includes('*'));
  const lines = mine?.lines ?? [];
  const delay = Number(lines.find(([k]) => k === 'crawl-delay')?.[1]);
  return {
    allow: lines.filter(([k, v]) => k === 'allow' && v).map(([, v]) => v),
    disallow: lines.filter(([k, v]) => k === 'disallow' && v).map(([, v]) => v),
    delayMs: Number.isFinite(delay) && delay > 0 ? Math.min(delay * 1000, MAX_DELAY_MS) : DEFAULT_DELAY_MS,
    sitemaps,
  };
}

/** Règle la plus longue qui correspond ; à égalité, Allow l'emporte (RFC 9309). Gère * et $. */
export function isAllowed(rules: Rules, pathAndQuery: string): boolean {
  // Motif robots.txt → regex : « * » = n'importe quoi, « $ » final = fin d'URL, le reste littéral
  const toRe = (p: string) => {
    const anchored = p.endsWith('$');
    const body = (anchored ? p.slice(0, -1) : p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`);
  };
  let best: { len: number; allow: boolean } = { len: -1, allow: true };
  for (const [list, allow] of [[rules.disallow, false], [rules.allow, true]] as const) {
    for (const p of list) {
      if (toRe(p).test(pathAndQuery) && (p.length > best.len || (p.length === best.len && allow))) best = { len: p.length, allow };
    }
  }
  return best.allow;
}

// ─── Requêtes polies : une file par site ───

const lastHit = new Map<string, Promise<void>>();

class Blocked extends Error {}

async function politeGet(url: string, accept = 'text/html,application/xhtml+xml'): Promise<string | null> {
  const u = new URL(url);
  const rules = await loadRobots(u.origin);
  if (!rules) throw new Blocked(`robots.txt injoignable sur ${u.host}`);
  if (!isAllowed(rules, u.pathname + u.search)) return null; // interdit : on ne demande même pas

  // File d'attente par site : chaque requête attend la fin du délai de la précédente
  const prev = lastHit.get(u.origin) ?? Promise.resolve();
  let release!: () => void;
  lastHit.set(u.origin, new Promise<void>(r => (release = r)));
  await prev;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
    // Défi anti-robot, accès refusé ou « trop de requêtes » : on s'arrête, on ne contourne pas
    if (res.status === 403 || res.status === 429 || res.status === 503) throw new Blocked(`${u.host} refuse l'accès automatique (HTTP ${res.status})`);
    if (!res.ok) return null;
    const body = await res.text();
    // Marqueurs de pages de défi (Cloudflare, Akamai…) ; un simple reCAPTCHA de formulaire ne compte pas
    if (/cf-chl|challenge-platform|just a moment\.\.\.|attention required|max challenge attempts|_Incapsula_Resource/i.test(body.slice(0, 20_000)) && !/JobPosting/.test(body)) {
      throw new Blocked(`${u.host} présente un défi anti-robot`);
    }
    return body;
  } finally {
    setTimeout(release, rules.delayMs);
  }
}

// ─── Découverte des pages d'offres ───

async function fromSitemaps(origin: string, scope: string): Promise<string[]> {
  const rules = await loadRobots(origin);
  const queue = [...(rules?.sitemaps.length ? rules.sitemaps : [`${origin}/sitemap.xml`])];
  const found: { loc: string; lastmod: string }[] = [];
  for (let i = 0; i < queue.length && i < MAX_SITEMAPS; i++) {
    const xml = await politeGet(queue[i], 'application/xml,text/xml').catch(e => { if (e instanceof Blocked) throw e; return null; });
    if (!xml) continue;
    if (xml.includes('<sitemapindex')) {
      // Index de sitemaps : on suit en priorité ceux qui parlent d'offres
      const children = xmlBlocks(xml, 'loc').map(s => decodeEntities(s.trim()));
      queue.push(...children.filter(c => JOB_PATH.test(c)), ...children.filter(c => !JOB_PATH.test(c)));
      continue;
    }
    for (const block of xmlBlocks(xml, 'url')) {
      const loc = decodeEntities(xmlBlocks(block, 'loc')[0]?.trim() ?? '');
      if (loc && JOB_PATH.test(new URL(loc, origin).pathname)) found.push({ loc, lastmod: xmlBlocks(block, 'lastmod')[0]?.trim() ?? '' });
    }
  }
  // Les plus récentes d'abord ; celles sous le chemin de la page carrières en priorité
  return found
    .sort((a, b) => Number(b.loc.includes(scope)) - Number(a.loc.includes(scope)) || b.lastmod.localeCompare(a.lastmod))
    .map(f => f.loc);
}

function linksFromListing(html: string, base: URL): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]), base);
      if (u.host === base.host && u.pathname !== base.pathname && JOB_PATH.test(u.pathname)) out.add(u.href);
    } catch { /* lien invalide */ }
  }
  // D'abord les liens qui portent un identifiant (« /emplois/63412345.html ») : ce sont des
  // offres, alors que « /emplois/metier-data.html » est souvent une page de catégorie
  return [...out].sort((a, b) => Number(/\d{4,}/.test(new URL(b).pathname)) - Number(/\d{4,}/.test(new URL(a).pathname)));
}

// ─── Lecture des données structurées JobPosting ───

type Json = Record<string, unknown>;
const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : (v as Json)?.name ? String((v as Json).name) : '');

export function extractJobPostings(html: string): Json[] {
  const out: Json[] = [];
  const visit = (node: unknown) => {
    for (const n of asArray(node)) {
      if (!n || typeof n !== 'object') continue;
      const o = n as Json;
      if (asArray(o['@type'] as string | string[]).includes('JobPosting')) out.push(o);
      if (o['@graph']) visit(o['@graph']);
      if (o.itemListElement) visit(asArray(o.itemListElement as unknown[]).map(e => (e as Json)?.item ?? e));
    }
  };
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1].trim())); } catch { /* JSON invalide : on ignore ce bloc */ }
  }
  return out;
}

function toJobDetail(p: Json, pageUrl: string, fallbackCompany: string): JobDetail | null {
  // Offre expirée selon le site lui-même : on ne la propose pas
  const validThrough = str(p.validThrough);
  if (validThrough && !Number.isNaN(Date.parse(validThrough)) && Date.parse(validThrough) < Date.now()) return null;

  const places = asArray(p.jobLocation as Json | Json[]).map(l => {
    const a = (l?.address ?? {}) as Json;
    return [str(a.addressLocality), str(a.addressRegion), str(a.addressCountry)].filter(Boolean).join(', ');
  }).filter(Boolean);
  if (str(p.jobLocationType) === 'TELECOMMUTE') places.push('Remote');

  const salary = (() => {
    const v = ((p.baseSalary as Json)?.value ?? {}) as Json;
    const min = v.minValue ?? v.value, max = v.maxValue;
    if (min == null) return 'Non précisé';
    return `${min}${max ? `–${max}` : ''} ${str((p.baseSalary as Json)?.currency)} ${str(v.unitText)}`.trim();
  })();
  const exp = p.experienceRequirements as Json | string | undefined;
  const months = typeof exp === 'object' ? Number(exp?.monthsOfExperience) : NaN;

  const title = htmlToText(str(p.title));
  if (!title) return null;
  return {
    title,
    company: str(p.hiringOrganization) || fallbackCompany,
    location: [...new Set(places)].join(' | '),
    description: htmlToText(str(p.description)),
    qualifications: [
      typeof exp === 'string' ? exp : '',
      Number.isFinite(months) ? `${Math.round(months / 12)} ans d'expérience` : '',
      htmlToText(str(p.qualifications)), htmlToText(str(p.skills)),
    ].filter(Boolean).join('\n'),
    salary,
    employmentType: asArray(p.employmentType as string | string[]).join(', '),
    datePosted: str(p.datePosted).slice(0, 10),
    url: typeof p.url === 'string' && /^https?:/.test(p.url) ? p.url : pageUrl,
    source: 'website',
  };
}

// ─── Points d'entrée ───

/** Pages d'offres découvertes sur le site (sitemaps, puis liens de la page carrières). */
async function discover(listingUrl: string): Promise<{ pages: string[]; listingHtml: string | null }> {
  const base = new URL(listingUrl);
  const listingHtml = await politeGet(base.href);
  const fromMap = await fromSitemaps(base.origin, base.pathname).catch(e => { if (e instanceof Blocked) throw e; return []; });
  const fromLinks = listingHtml ? linksFromListing(listingHtml, base) : [];
  return { pages: [...new Set([...fromLinks, ...fromMap])], listingHtml };
}

export interface WebsiteOptions { knownUrls?: Set<string>; maxPages?: number }

/**
 * Offres d'un site carrières. Les pages déjà connues ne sont PAS relues : on renvoie une
 * entrée minimale (knownOnly) qui sert seulement à dire « toujours en ligne ».
 */
export async function fetchWebsiteJobs(name: string, listingUrl: string, opts: WebsiteOptions = {}): Promise<JobDetail[]> {
  if (isExcludedHost(new URL(listingUrl).hostname)) return [];
  const { pages, listingHtml } = await discover(listingUrl);
  const out: JobDetail[] = [];
  // Certaines pages carrières listent déjà toutes les offres en JSON-LD
  for (const p of listingHtml ? extractJobPostings(listingHtml) : []) {
    const job = toJobDetail(p, listingUrl, name);
    if (job) out.push(job);
  }
  let read = 0;
  for (const page of pages) {
    if (opts.knownUrls?.has(normalizeUrl(page))) { out.push({ title: '', company: name, location: '', description: '', qualifications: '', salary: '', employmentType: '', datePosted: '', url: page, source: 'website', knownOnly: true }); continue; }
    if (read >= (opts.maxPages ?? MAX_JOB_PAGES)) continue;
    read++;
    const html = await politeGet(page).catch(e => { if (e instanceof Blocked) throw e; return null; });
    for (const p of html ? extractJobPostings(html) : []) {
      const job = toJobDetail(p, page, name);
      if (job) out.push({ ...job, url: page }); // l'URL de la page fait foi (unique, stable)
    }
  }
  return out;
}

/** Vérification à l'ajout : le site est-il lisible et publie-t-il des JobPosting ? */
export async function probeWebsite(listingUrl: string): Promise<{ ok: true; count: number } | { ok: false; reason: 'robots' | 'blocked' | 'no_structured_data' | 'excluded' }> {
  try {
    const u = new URL(listingUrl);
    if (isExcludedHost(u.hostname)) return { ok: false, reason: 'excluded' };
    const rules = await loadRobots(u.origin);
    if (!rules || !isAllowed(rules, u.pathname + u.search)) return { ok: false, reason: 'robots' };
    const { pages, listingHtml } = await discover(listingUrl);
    if (listingHtml && extractJobPostings(listingHtml).length > 0) return { ok: true, count: Math.max(pages.length, extractJobPostings(listingHtml).length) };
    for (const page of pages.slice(0, 3)) {
      const html = await politeGet(page);
      if (html && extractJobPostings(html).length > 0) return { ok: true, count: pages.length };
    }
    return { ok: false, reason: 'no_structured_data' };
  } catch (e) {
    return { ok: false, reason: e instanceof Blocked ? 'blocked' : 'no_structured_data' };
  }
}

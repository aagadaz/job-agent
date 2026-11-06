import { STATUSES, SORTS, type ApplicationStatus, type FeedFilters, type OfferSort } from '@/db/dashboard';
import { COUNTRY_CODES } from '@/lib/countries';
import { SUPPORTED_ATS } from '@/sources/ats';

// Lecture des filtres depuis l'URL. Toute valeur vient du navigateur : chacune est
// confrontée à une LISTE BLANCHE (statuts, pays, sources connus) avant d'atteindre le SQL.

export type RawParams = Record<string, string | string[] | undefined>;

export const SOURCES = ['adzuna', 'francetravail', ...SUPPORTED_ATS] as const;
export const SINCE_OPTIONS = [1, 7, 30] as const;
export const SCORE_OPTIONS = [50, 60, 70, 80] as const;

/** ?status=a&status=b ou ?status=a,b → ['a','b'], filtré par la liste blanche, sans doublons. */
function list<T extends string>(raw: string | string[] | undefined, allowed: readonly T[]): T[] {
  const values = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap(v => v.split(','));
  return [...new Set(values.filter((v): v is T => (allowed as readonly string[]).includes(v)))];
}
const one = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw);

export interface ParsedFilters extends FeedFilters { sort: OfferSort }

export function parseFilters(p: RawParams): ParsedFilters {
  const dismissed = one(p.dismissed) === '1';
  const minScore = Number(one(p.min));
  const since = Number(one(p.since));
  const q = (one(p.q) ?? '').trim().slice(0, 80);
  return {
    dismissed,
    showRejected: one(p.rejected) === '1' || dismissed,
    statuses: list<ApplicationStatus>(p.status, STATUSES),
    countries: list(p.country, [...COUNTRY_CODES, 'none']),
    sources: list(p.source, SOURCES),
    minScore: (SCORE_OPTIONS as readonly number[]).includes(minScore) ? minScore : undefined,
    sinceDays: (SINCE_OPTIONS as readonly number[]).includes(since) ? since : undefined,
    q: q || undefined,
    sort: SORTS.find(s => s === one(p.sort)) ?? 'recent',
  };
}

/** Nombre de filtres actifs (hors tri et vue) : pour le libellé « Filtres (3) ». */
export function activeCount(f: ParsedFilters): number {
  return (f.statuses?.length ?? 0) + (f.countries?.length ?? 0) + (f.sources?.length ?? 0)
    + (f.minScore !== undefined ? 1 : 0) + (f.sinceDays ? 1 : 0) + (f.q ? 1 : 0) + (f.showRejected && !f.dismissed ? 1 : 0);
}

/** Sérialise des filtres en URL ; `patch` remplace des familles entières (undefined = retirer). */
export function filtersHref(f: ParsedFilters, patch: Partial<ParsedFilters> = {}): string {
  const g = { ...f, ...patch };
  const s = new URLSearchParams();
  for (const v of g.statuses ?? []) s.append('status', v);
  for (const v of g.countries ?? []) s.append('country', v);
  for (const v of g.sources ?? []) s.append('source', v);
  if (g.minScore !== undefined) s.set('min', String(g.minScore));
  if (g.sinceDays) s.set('since', String(g.sinceDays));
  if (g.q) s.set('q', g.q);
  if (g.dismissed) s.set('dismissed', '1');
  else if (g.showRejected) s.set('rejected', '1');
  if (g.sort !== 'recent') s.set('sort', g.sort);
  const qs = s.toString();
  return qs ? `/offers?${qs}` : '/offers';
}

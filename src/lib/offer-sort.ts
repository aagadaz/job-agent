// Tri MULTI-CRITÈRES du fil d'offres. Module pur (aucun import serveur) : utilisé par la page
// (liens, pastilles) et par la requête SQL (dashboard.ts).
//
// Un tri = une liste ordonnée de critères : [{ key: 'score', dir: 'desc' }, { key: 'posted', dir: 'asc' }]
// signifie « par note décroissante, puis, à note égale, par date de publication croissante ».
// Dans l'URL : ?sort=score.desc,posted.asc

export const SORT_KEYS = ['recent', 'score', 'posted', 'company'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';
export interface SortSpec { key: SortKey; dir: SortDir }

export const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Ajout au fil',
  score: 'Note',
  posted: 'Date de publication',
  company: 'Entreprise',
};

/** Sens « naturel » au 1er clic : le plus récent / la meilleure note d'abord, A → Z. */
export const DEFAULT_DIR: Record<SortKey, SortDir> = { recent: 'desc', score: 'desc', posted: 'desc', company: 'asc' };

/** Ce que veut dire chaque sens, en mots (les flèches seules sont ambiguës). */
export const DIR_LABELS: Record<SortKey, Record<SortDir, string>> = {
  recent: { desc: 'plus récentes d’abord', asc: 'plus anciennes d’abord' },
  score: { desc: 'meilleures d’abord', asc: 'moins bonnes d’abord' },
  posted: { desc: 'plus récentes d’abord', asc: 'plus anciennes d’abord' },
  company: { asc: 'A → Z', desc: 'Z → A' },
};

export const DEFAULT_SORT: SortSpec[] = [{ key: 'recent', dir: 'desc' }];
const MAX_KEYS = SORT_KEYS.length;

/** « score.desc,posted » → critères validés (liste blanche), sans doublon de clé. */
export function parseSort(raw: string | undefined): SortSpec[] {
  const out: SortSpec[] = [];
  for (const part of (raw ?? '').split(',').slice(0, MAX_KEYS)) {
    const [k, d] = part.trim().split('.');
    const key = SORT_KEYS.find(s => s === k);
    if (!key || out.some(s => s.key === key)) continue;
    out.push({ key, dir: d === 'asc' || d === 'desc' ? d : DEFAULT_DIR[key] });
  }
  return out.length ? out : DEFAULT_SORT;
}

export function serializeSort(specs: SortSpec[]): string {
  return specs.map(s => `${s.key}.${s.dir}`).join(',');
}

export const isDefaultSort = (specs: SortSpec[]) => serializeSort(specs) === serializeSort(DEFAULT_SORT);

/**
 * Clic sur une pastille de tri : absent → ajouté EN DERNIER (sens naturel) ; présent dans son
 * sens naturel → sens inversé ; présent inversé → retiré. Si plus rien : tri par défaut.
 */
export function cycleSort(specs: SortSpec[], key: SortKey): SortSpec[] {
  // Tri par défaut jamais touché : le 1er critère choisi le REMPLACE (sinon « Note » passerait
  // derrière « Ajout au fil » et ne servirait presque à rien)
  if (isDefaultSort(specs) && key !== DEFAULT_SORT[0].key) return [{ key, dir: DEFAULT_DIR[key] }];
  const i = specs.findIndex(s => s.key === key);
  let next: SortSpec[];
  if (i < 0) next = [...specs, { key, dir: DEFAULT_DIR[key] }];
  else if (specs[i].dir === DEFAULT_DIR[key]) next = specs.map((s, j) => (j === i ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s));
  else next = specs.filter((_, j) => j !== i);
  return next.length ? next : DEFAULT_SORT;
}

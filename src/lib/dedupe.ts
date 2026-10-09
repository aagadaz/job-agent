import type { JobDetail } from './types';
import { fold } from './text';

/** Clé métier d'une offre : même entreprise + même intitulé = même poste, quelle que soit la source. */
export function businessKey(o: JobDetail): string {
  return `${fold(o.company)}|${fold(o.title)}`.replace(/[^a-z0-9|]+/g, ' ').trim();
}

/**
 * Déduplique entre sources. En cas de doublon, on garde la version la plus riche
 * (description la plus longue) : en pratique la page carrière plutôt que l'agrégateur.
 */
export function dedupeAcrossSources(offers: JobDetail[]): JobDetail[] {
  const best = new Map<string, JobDetail>();
  for (const o of offers) {
    const key = businessKey(o);
    const current = best.get(key);
    if (!current || o.description.length > current.description.length) best.set(key, o);
  }
  return [...best.values()];
}
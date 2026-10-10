/**
 * Applique `fn` à chaque élément avec au plus `limit` appels simultanés (ordre des résultats conservé).
 * Promise.all sur 100 URL ouvrirait 100 connexions d'un coup : impoli, et souvent bloqué (HTTP 429).
 */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

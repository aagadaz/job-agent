import 'dotenv/config'; // en premier : charge .env avant que les autres modules lisent process.env
import Anthropic from '@anthropic-ai/sdk';
import { pool } from './db/client';
import {
  getActiveUsers, getCompanies, getSeenUrls, upsertOffers, insertUserOffers, startRun, finishRun,
} from './db/repository';
import { decrypt } from './lib/crypto';
import { deriveKeywords } from './lib/cv-analyzer';
import { dedupeAcrossSources } from './lib/dedupe';
import { excludeByTitle, includeByTitle, matchesLocation } from './lib/prefilter';
import { scoreOffers } from './lib/scorer';
import type { JobDetail } from './lib/types';
import { normalizeUrl } from './lib/url';
import { fetchAdzunaOffers } from './sources/adzuna';
import { fetchCompanyJobs } from './sources/ats';

type ActiveUser = Awaited<ReturnType<typeof getActiveUsers>>[number];

/** Collecte toutes les sources en parallèle. Une source en panne n'empêche pas les autres. */
async function collect(userId: string, keywords: string[], location: string): Promise<JobDetail[]> {
  const companies = await getCompanies(userId);

  const tasks: { label: string; run: () => Promise<JobDetail[]> }[] = [
    { label: 'Adzuna', run: () => fetchAdzunaOffers(keywords, { location }) },
    ...companies.map(c => ({
      label: `${c.name} (${c.ats})`,
      // Les pages carrières publient des postes dans le monde entier : filtre géographique
      run: async () => matchesLocation((await fetchCompanyJobs(c)) ?? [], location),
    })),
  ];

  const results = await Promise.allSettled(tasks.map(t => t.run()));

  return results.flatMap((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`   · ${tasks[i].label} : ${r.value.length} offres`);
      return r.value;
    }
    console.warn(`   ⚠️ ${tasks[i].label} en échec : ${(r.reason as Error).message}`);
    return [];
  });
}

/** Pipeline complet pour UN utilisateur. Lève une erreur en cas d'échec. */
async function processUser({ user, profile }: ActiveUser): Promise<Record<string, number>> {
  const client = new Anthropic({ apiKey: decrypt(user.anthropicKeyEncrypted!) });
  const cvText = profile.cvText!;

  const keywords = profile.keywords.length > 0 ? profile.keywords : await deriveKeywords(client, cvText);
  console.log(`   Mots-clés : ${keywords.join(', ')} · ${profile.location}`);

  // Entonnoir : collecte → déduplication inter-sources → filtres gratuits → déjà vues → scoring payant
  const fetched = await collect(user.id, keywords, profile.location);
  const unique = dedupeAcrossSources(fetched);
  const filtered = includeByTitle(excludeByTitle(unique, profile.excludeTerms), profile.includeTerms);
  const seen = await getSeenUrls(user.id);
  const fresh = filtered.filter(o => !seen.has(normalizeUrl(o.url)));
  console.log(`   ${fetched.length} collectées → ${unique.length} uniques → ${filtered.length} après filtres → ${fresh.length} nouvelles`);

  const offerIds = await upsertOffers(fresh);
  const scored = await scoreOffers(client, cvText, fresh);
  const { kept, rejected } = await insertUserOffers(user.id, scored, offerIds, profile.rejectThreshold);

  return {
    fetched: fetched.length, unique: unique.length, afterFilters: filtered.length,
    new: fresh.length, kept, rejected,
  };
}

async function main() {
  const activeUsers = await getActiveUsers();
  console.log(`👥 ${activeUsers.length} utilisateur(s) actif(s)\n`);
  let failures = 0;

  for (const entry of activeUsers) {
    console.log(`▶ ${entry.user.email}`);
    const runId = await startRun(entry.user.id);
    try {
      const stats = await processUser(entry);
      await finishRun(runId, { status: 'success', stats });
      console.log(`   ✅ ${stats.kept} retenues, ${stats.rejected} écartées\n`);
    } catch (err) {
      failures++;
      const message = (err as Error).message;
      await finishRun(runId, { status: 'error', error: message });
      console.error(`   ❌ ${message}\n`);
    }
  }

  if (failures > 0) process.exitCode = 1;
}

main()
  .catch(err => {
    console.error('ERREUR FATALE :', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

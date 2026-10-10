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
      // Les gros ATS (Workday, SmartRecruiters) sont interrogés avec les mots-clés du profil
      run: async () => matchesLocation((await fetchCompanyJobs(c, { keywords })) ?? [], location),
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Variable d'environnement facultative qui doit être un UUID (vide = absente). */
function optionalUuid(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!UUID.test(value)) throw new Error(`${name} n'est pas un UUID valide`);
  return value;
}

async function main() {
  // Lancement manuel (bouton de l'interface) : un seul utilisateur, et la ligne "runs"
  // déjà créée par l'interface au moment du clic. Lancement planifié : tout le monde.
  const onlyUserId = optionalUuid('ONLY_USER_ID');
  const presetRunId = optionalUuid('RUN_ID');

  const activeUsers = await getActiveUsers(onlyUserId);
  if (onlyUserId && activeUsers.length === 0) {
    const message = 'Profil incomplet : CV ou clé Claude manquant';
    // On clôt la ligne créée au clic, sinon l'interface afficherait « en cours » indéfiniment
    if (presetRunId) await finishRun(presetRunId, { status: 'error', error: message });
    throw new Error(`${message} (utilisateur ${onlyUserId})`);
  }
  console.log(`👥 ${activeUsers.length} utilisateur(s) actif(s)\n`);
  let failures = 0;

  for (const entry of activeUsers) {
    console.log(`▶ ${entry.user.email}`);
    const runId = presetRunId ?? (await startRun(entry.user.id));
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
  .catch(async err => {
    console.error('ERREUR FATALE :', err);
    process.exitCode = 1;
    // Best effort : clore la ligne créée au clic. Échouera si c'est la base elle-même qui est
    // en cause ; l'interface s'en apercevra alors via l'API GitHub (src/lib/run-status.ts).
    const runId = process.env.RUN_ID?.trim();
    if (runId && UUID.test(runId)) {
      await finishRun(runId, { status: 'error', error: (err as Error).message.slice(0, 500) }).catch(() => {});
    }
  })
  .finally(() => pool.end());

import 'dotenv/config'; // en premier : charge .env avant que les autres modules lisent process.env
import Anthropic from '@anthropic-ai/sdk';
import { pool } from './db/client';
import {
  getActiveUsers, getSeenUrls, upsertOffers, insertUserOffers, startRun, finishRun,
} from './db/repository';
import { decrypt } from './lib/crypto';
import { deriveKeywords } from './lib/cv-analyzer';
import { excludeByTitle } from './lib/prefilter';
import { scoreOffers } from './lib/scorer';
import { normalizeUrl } from './lib/url';
import { fetchAdzunaOffers } from './sources/adzuna';

type ActiveUser = Awaited<ReturnType<typeof getActiveUsers>>[number];

/** Pipeline complet pour UN utilisateur. Lève une erreur en cas d'échec. */
async function processUser({ user, profile }: ActiveUser): Promise<Record<string, number>> {
  // Chaque utilisateur paie ses propres appels : un client Anthropic par utilisateur
  const client = new Anthropic({ apiKey: decrypt(user.anthropicKeyEncrypted!) });
  const cvText = profile.cvText!;

  const keywords = profile.keywords.length > 0 ? profile.keywords : await deriveKeywords(client, cvText);
  console.log(`   Mots-clés : ${keywords.join(', ')} · ${profile.location}`);

  // Entonnoir : collecte → filtre gratuit → déduplication → scoring payant
  const fetched = await fetchAdzunaOffers(keywords, { location: profile.location });
  const filtered = excludeByTitle(fetched, profile.excludeTerms);
  const seen = await getSeenUrls(user.id);
  const fresh = filtered.filter(o => !seen.has(normalizeUrl(o.url)));
  console.log(`   ${fetched.length} collectées → ${filtered.length} après filtres → ${fresh.length} nouvelles`);

  const offerIds = await upsertOffers(fresh, 'adzuna');
  const scored = await scoreOffers(client, cvText, fresh);
  const { kept, rejected } = await insertUserOffers(user.id, scored, offerIds, profile.rejectThreshold);

  return { fetched: fetched.length, afterFilters: filtered.length, new: fresh.length, kept, rejected };
}

async function main() {
  const activeUsers = await getActiveUsers();
  console.log(`👥 ${activeUsers.length} utilisateur(s) actif(s)\n`);
  let failures = 0;

  // Séquentiel : on reste loin des quotas Adzuna, et un log par utilisateur reste lisible
  for (const entry of activeUsers) {
    console.log(`▶ ${entry.user.email}`);
    const runId = await startRun(entry.user.id);
    try {
      const stats = await processUser(entry);
      await finishRun(runId, { status: 'success', stats });
      console.log(`   ✅ ${stats.kept} retenues, ${stats.rejected} écartées\n`);
    } catch (err) {
      // Isolation des pannes : l'échec d'un utilisateur (clé révoquée…) n'arrête pas les autres
      failures++;
      const message = (err as Error).message;
      await finishRun(runId, { status: 'error', error: message });
      console.error(`   ❌ ${message}\n`);
    }
  }

  if (failures > 0) process.exitCode = 1; // le job GitHub passe au rouge, sans interrompre les autres
}

main()
  .catch(err => {
    console.error('ERREUR FATALE :', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
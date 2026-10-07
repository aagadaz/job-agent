import 'dotenv/config'; // en premier : charge .env avant que les autres modules lisent process.env
import { analyzeCV } from './lib/cv-analyzer';
import { ensureHeaders, getExistingUrls, appendOffers, appendRejected, normalizeUrl } from './lib/sheets';
import { scoreOffers } from './lib/scorer';
import { fetchAdzunaOffers } from './sources/adzuna';

const CV_PATH = process.env.CV_PATH ?? './CV_AfzalAgadazi.pdf';

// Offres dont le score est <= à ce seuil : écartées du Sheet principal.
const parsed = Number(process.env.SCORE_REJECT_THRESHOLD);
const REJECT_THRESHOLD = Number.isFinite(parsed) && process.env.SCORE_REJECT_THRESHOLD ? parsed : 35;

async function main() {
  // 1. CV → mots-clés + texte du CV
  const { cvText, params } = await analyzeCV(CV_PATH);

  // 2. État du Sheet (fail fast : avant tout appel coûteux)
  await ensureHeaders();
  const knownUrls = await getExistingUrls();
  console.log(`📋 ${knownUrls.size} offres déjà vues (retenues + écartées)\n`);

  // 3. Collecte via la source Adzuna
  const fetched = await fetchAdzunaOffers(params.keywords, { location: params.location });

  // 4. Déduplication contre le Sheet
  const newOffers = fetched.filter(o => !knownUrls.has(normalizeUrl(o.url)));
  console.log(`\n📥 ${fetched.length} offres récupérées, dont ${newOffers.length} nouvelles`);

  // 5. Scoring
  console.log(`\n🧠 Scoring de ${newOffers.length} offres...`);
  const scored = await scoreOffers(cvText, newOffers);

  // 6. Filtre : une offre non notée (échec du scoring) est gardée, pour ne rien perdre en silence
  const kept = scored.filter(o => o.scoring === null || o.scoring.score > REJECT_THRESHOLD);
  const rejected = scored.filter(o => o.scoring !== null && o.scoring.score <= REJECT_THRESHOLD);

  // 7. Écriture
  console.log('\n--- Envoi vers Google Sheets ---');
  await appendOffers(kept);
  await appendRejected(rejected);

  const toApply = kept.filter(o => o.scoring?.verdict === 'Postuler');
  console.log(`\n🏁 Terminé : ${kept.length} retenues, ${rejected.length} écartées (score ≤ ${REJECT_THRESHOLD}), ${toApply.length} à postuler en priorité`);
  toApply.slice(0, 5).forEach(o => console.log(`   ⭐ ${o.scoring!.score} — ${o.title} @ ${o.company}`));
}

main().catch(err => {
  console.error('ERREUR FATALE :', err);
  process.exit(1);
});

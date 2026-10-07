import 'dotenv/config'; // en premier : charge .env avant que les autres modules lisent process.env
import { analyzeCV } from './lib/cv-analyzer';
import { ensureHeaders, getExistingUrls, appendOffers, normalizeUrl } from './lib/sheets';
import { scoreOffers } from './lib/scorer';
import { fetchAdzunaOffers } from './sources/adzuna';

const CV_PATH = process.env.CV_PATH ?? './CV_AfzalAgadazi.pdf';

async function main() {
  // 1. CV → mots-clés + texte du CV
  const { cvText, params } = await analyzeCV(CV_PATH);

  // 2. État du Sheet (fail fast : avant tout appel coûteux)
  await ensureHeaders();
  const knownUrls = await getExistingUrls();
  console.log(`📋 ${knownUrls.size} offres déjà dans le Sheet\n`);

  // 3. Collecte via la source Adzuna
  const fetched = await fetchAdzunaOffers(params.keywords, { location: params.location });

  // 4. Déduplication contre le Sheet
  const newOffers = fetched.filter(o => !knownUrls.has(normalizeUrl(o.url)));
  console.log(`\n📥 ${fetched.length} offres récupérées, dont ${newOffers.length} nouvelles`);

  // 5. Scoring puis écriture
  console.log(`\n🧠 Scoring de ${newOffers.length} offres...`);
  const scored = await scoreOffers(cvText, newOffers);

  console.log('\n--- Envoi vers Google Sheets ---');
  await appendOffers(scored);

  const toApply = scored.filter(o => o.scoring?.verdict === 'Postuler');
  console.log(`\n🏁 Terminé : ${scored.length} nouvelles offres, ${toApply.length} à postuler en priorité`);
  toApply.slice(0, 5).forEach(o => console.log(`   ⭐ ${o.scoring!.score} — ${o.title} @ ${o.company}`));
}

main().catch(err => {
  console.error('ERREUR FATALE :', err);
  process.exit(1);
});
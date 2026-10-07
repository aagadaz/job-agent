import { chromium, Page } from 'playwright';
import * as dotenv from 'dotenv';
import { analyzeCV } from '../lib/cv-analyzer';
import { ensureHeaders, getExistingUrls, appendOffers, normalizeUrl } from '../lib/sheets';
import { scoreOffers } from '../lib/scorer';
import type { JobDetail } from '../lib/types';

dotenv.config();

const CV_PATH = process.env.CV_PATH ?? './CV_AfzalAgadazi.pdf';
const HEADLESS = process.env.HEADLESS !== 'false'; // HEADLESS=false pour voir le navigateur

const BASE_PARAMS = {
  lieux: '711', // Île-de-France
  salaireMinimum: '20',
  salaireMaximum: '200',
  typesContrat: '101888', // CDI
  typesConvention: ['143684', '143685', '143686', '143687'],
};

interface OfferCard {
  title: string;
  company: string;
  url: string;
}

function buildSearchUrl(keyword: string, niveauxExperience: string): string {
  const params = new URLSearchParams();
  params.set('lieux', BASE_PARAMS.lieux);
  params.set('motsCles', keyword);
  params.set('salaireMinimum', BASE_PARAMS.salaireMinimum);
  params.set('salaireMaximum', BASE_PARAMS.salaireMaximum);
  params.set('typesContrat', BASE_PARAMS.typesContrat);
  params.set('niveauxExperience', niveauxExperience);
  BASE_PARAMS.typesConvention.forEach(t => params.append('typesConvention', t));
  return `https://www.apec.fr/candidat/recherche-emploi.html/emploi?${params.toString()}`;
}

/** Le JSON-LD de l'APEC contient du HTML : on le convertit en texte lisible. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function searchOffers(page: Page, keyword: string, niveau: string): Promise<OfferCard[]> {
  await page.goto(buildSearchUrl(keyword, niveau));
  await page.waitForTimeout(3000);

  return page.$$eval('.card-offer', cards =>
    cards.map(card => ({
      title: card.querySelector('h2.card-title')?.textContent?.trim() ?? '',
      company: card.querySelector('p.card-offer__company')?.textContent?.trim() ?? '',
      url:
        (card.closest('a') as HTMLAnchorElement | null)?.href ??
        (card.querySelector('a') as HTMLAnchorElement | null)?.href ??
        '',
    })),
  );
}

async function scrapeOfferDetail(page: Page, url: string): Promise<JobDetail | null> {
  await page.goto(url);
  await page.waitForTimeout(2000);

  try {
    const el = await page.$('script[type="application/ld+json"]');
    if (!el) {
      console.warn('⚠️ Pas de JSON-LD pour :', url);
      return null;
    }
    const data = JSON.parse((await el.textContent()) ?? '');

    return {
      title: data.title ?? '',
      description: htmlToText(data.description ?? ''),
      qualifications: htmlToText(data.qualifications ?? ''),
      salary: String(data.baseSalary?.value?.value ?? 'Non précisé'),
      employmentType: data.employmentType ?? '',
      datePosted: data.datePosted ?? '',
      company: data.hiringOrganization?.name ?? '',
      location: data.jobLocation?.address?.addressLocality ?? '',
      url,
    };
  } catch {
    console.error('Erreur parsing JSON-LD pour :', url);
    return null;
  }
}

async function main() {
  // 1. CV → paramètres de recherche (+ texte du CV pour le scoring)
  const { cvText, params } = await analyzeCV(CV_PATH);

  // 2. État actuel du Sheet : en-têtes + offres déjà connues
  await ensureHeaders();
  const knownUrls = await getExistingUrls();
  console.log(`📋 ${knownUrls.size} offres déjà dans le Sheet`);

  // 3. Scraping — on ne visite le détail QUE des offres nouvelles
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage();
  const newOffers: JobDetail[] = [];

  try {
    const toScrape = new Map<string, OfferCard>(); // clé = URL normalisée → dédup inter-mots-clés

    for (const keyword of params.keywords) {
      console.log(`\n🔎 Recherche : "${keyword}"`);
      const cards = await searchOffers(page, keyword, params.niveauxExperience);
      let fresh = 0;
      for (const card of cards) {
        if (!card.url) continue;
        const key = normalizeUrl(card.url);
        if (knownUrls.has(key) || toScrape.has(key)) continue;
        toScrape.set(key, card);
        fresh++;
      }
      console.log(`   ${cards.length} offres trouvées, dont ${fresh} nouvelles`);
    }

    console.log(`\n📥 ${toScrape.size} offres nouvelles à détailler`);
    for (const card of toScrape.values()) {
      console.log(`   Scraping : ${card.title} — ${card.company}`);
      const detail = await scrapeOfferDetail(page, card.url);
      if (detail) newOffers.push(detail);
      await page.waitForTimeout(1000 + Math.random() * 2000); // politesse envers le serveur
    }
  } catch (err) {
    // On garde ce qui a été scrapé avant l'erreur
    console.error('❌ Erreur pendant le scraping :', err);
  } finally {
    await browser.close();
  }

  // 4. Scoring des offres nouvelles par rapport au CV
  console.log(`\n🧠 Scoring de ${newOffers.length} offres...`);
  const scored = await scoreOffers(cvText, newOffers);

  // 5. Écriture dans le Sheet (append-only : le statut existant n'est jamais touché)
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
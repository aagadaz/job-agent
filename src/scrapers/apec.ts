import { chromium, Page } from 'playwright';
import { initSheet, appendOffers } from '../lib/sheets';
import * as dotenv from 'dotenv';
import { analyzeCV } from '../lib/cv-analyzer';

dotenv.config();



const BASE_PARAMS = {
  lieux: '711',
  salaireMinimum: '20',
  salaireMaximum: '200',
  typesContrat: '101888',
  typesConvention: ['143684', '143685', '143686', '143687'],
  niveauxExperience: '101881',
};

interface JobDetail {
  title: string;
  description: string;
  qualifications: string;
  salary: string;
  employmentType: string;
  datePosted: string;
  company: string;
  location: string;
  url: string;
}

function buildSearchUrl(keyword: string): string {
  const params = new URLSearchParams();
  params.set('lieux', BASE_PARAMS.lieux);
  params.set('motsCles', keyword);
  params.set('salaireMinimum', BASE_PARAMS.salaireMinimum);
  params.set('salaireMaximum', BASE_PARAMS.salaireMaximum);
  params.set('typesContrat', BASE_PARAMS.typesContrat);
  params.set('niveauxExperience', BASE_PARAMS.niveauxExperience);
  BASE_PARAMS.typesConvention.forEach(t => params.append('typesConvention', t));
  return `https://www.apec.fr/candidat/recherche-emploi.html/emploi?${params.toString()}`;
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

    const jsonLd = await el.textContent() ?? '';
    const data = JSON.parse(jsonLd);

    return {
      title: data.title ?? '',
      description: data.description ?? '',
      qualifications: data.qualifications ?? '',
      salary: data.baseSalary?.value?.value ?? 'Non précisé',
      employmentType: data.employmentType ?? '',
      datePosted: data.datePosted ?? '',
      company: data.hiringOrganization?.name ?? '',
      location: data.jobLocation?.address?.addressLocality ?? '',
      url: url,
    };
  } catch {
    console.error('Erreur parsing JSON-LD pour :', url);
    return null;
  }
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Déclaré ici — accessible dans try ET finally
  const detailedOffers: JobDetail[] = [];

  try {
    const cvParams = await analyzeCV('./CV_Afzal_Agadazi.pdf');
    console.log('\n Paramètres générés par Claude:');
    console.log('Mots-clés:', cvParams.keywords);
    console.log('Expérience:',cvParams.niveauxExperience);

    const allOffers: any[] = [];

    for (const keyword of cvParams.keywords){
      console.log('\n Recherche:"${keyword}"');
      const url = buildSearchUrl(keyword);
      
    await page.goto(url);
    await page.waitForTimeout(3000);

    const offers = await page.$$eval('.card-offer', (cards) => {
      return cards.map(card => ({
        title: card.querySelector('h2.card-title')?.textContent?.trim() ?? '',
        company: card.querySelector('p.card-offer__company')?.textContent?.trim() ?? '',
        description: card.querySelector('p.card-offer__description')?.textContent?.trim() ?? '',
        url: (card.closest('a') as HTMLAnchorElement)?.href ?? '',
      }));
    });

    console.log(`${offers.length} offres trouvées`);
    

    for (const offer of offers) {
      console.log(`Scraping : ${offer.title} — ${offer.company}`);
      const detail = await scrapeOfferDetail(page, offer.url);
      if (detail) {
        detailedOffers.push(detail);
      }
      await page.waitForTimeout(1000 + Math.random() * 2000);
    }

  }

    console.log(`\n✅ ${detailedOffers.length} offres scrapées avec succès`);

  } catch (err) {
    console.error('ERREUR :', err);
  } finally {
    console.log('\n--- Envoi vers Google Sheets ---');
    await initSheet();
    await appendOffers(detailedOffers);
    await browser.close();
  }
}

main();

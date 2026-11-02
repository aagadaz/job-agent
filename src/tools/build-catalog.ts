import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { lt, sql } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { catalogCompanies } from '../db/schema';
import { parseCsv } from '../lib/csv';
import { mapPool } from '../lib/concurrency';
import { resolveCompany } from '../sources/ats';

// Construit (ou rafraîchit) le catalogue partagé d'entreprises.
// Usage : npm run catalog:build
//
// Pour chaque candidat (data/catalog-candidates.csv + data/entreprises_100.csv) :
// on détecte son ATS (par l'URL si fournie, sinon par le nom) et on ne garde QUE les
// entreprises dont le tableau d'offres répond ET publie au moins une offre. Les entrées
// du catalogue qui ne passent plus la vérification sont retirées.

const CATEGORY_OF = (sector: string): string => {
  const s = sector.toLowerCase();
  if (/conseil|esn|ingénierie|audit/.test(s)) return 'Consulting';
  if (/fintech|finance|banque|assurance|gestion d'actifs/.test(s)) return 'Financial services';
  if (/industrie|grand groupe|luxe|énergie|distribution|télécom|environnement|satellite|robotique/.test(s)) return 'Industry';
  return 'AI & tech';
};

interface Candidate { name: string; url: string; sector: string; category: string; countries: string[] }

function readCandidates(): Candidate[] {
  const out = new Map<string, Candidate>();
  // 1) Catalogue de candidats : nom, url_carrieres, secteur, categorie, pays (séparés par « | »)
  for (const [name, url, sector, category, countries] of parseCsv(readFileSync('data/catalog-candidates.csv', 'utf8')).slice(1)) {
    if (name) out.set(name.toLowerCase(), { name, url: url ?? '', sector: sector ?? '', category: category || CATEGORY_OF(sector ?? ''), countries: (countries || 'fr').split('|') });
  }
  // 2) Les 100 entreprises déjà vérifiées (avec URL) : nom, url_carrieres, ats, secteur, …
  for (const [name, url, , sector] of parseCsv(readFileSync('data/entreprises_100.csv', 'utf8')).slice(1)) {
    if (name) out.set(name.toLowerCase(), { name, url: url ?? '', sector: sector ?? '', category: CATEGORY_OF(sector ?? ''), countries: ['fr'] });
  }
  return [...out.values()];
}

async function main() {
  const startedAt = new Date();
  const candidates = readCandidates();
  console.log(`🔎 ${candidates.length} entreprises à vérifier…`);

  let found = 0;
  const missing: string[] = [];
  // Concurrence modérée : on interroge des API publiques, on reste poli (et sous leurs limites)
  await mapPool(candidates, 4, async c => {
    const r = await resolveCompany(c.name, c.url || undefined).catch(() => null);
    if (!r?.ok || r.jobCount === 0) { missing.push(c.name); return; }
    found++;
    const values = { name: c.name, ats: r.ref.ats, slug: r.ref.slug, sector: c.sector, category: c.category, countries: c.countries, jobCount: r.jobCount, verifiedAt: new Date() };
    await db.insert(catalogCompanies).values(values).onConflictDoUpdate({
      target: [catalogCompanies.ats, catalogCompanies.slug],
      set: { name: values.name, sector: values.sector, category: values.category, countries: values.countries, jobCount: values.jobCount, verifiedAt: values.verifiedAt },
    });
    console.log(`   ✅ ${c.name} → ${r.ref.ats} (${r.jobCount} offres)`);
  });

  // Entrées non revérifiées pendant ce passage (ATS changé, plus d'offres) : retirées du catalogue
  const removed = await db.delete(catalogCompanies).where(lt(catalogCompanies.verifiedAt, startedAt)).returning({ id: catalogCompanies.id });
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(catalogCompanies);

  console.log(`\n📚 Catalogue : ${n} entreprises (${found} vérifiées ce passage, ${removed.length} retirées).`);
  console.log(`⚠️  ${missing.length} sans flux public détecté : ${missing.sort().join(', ')}`);
}

main()
  .catch(err => { console.error('ERREUR :', err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => pool.end());

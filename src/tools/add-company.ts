import 'dotenv/config';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { users, companies } from '../db/schema';
import { detectAts, fetchCompanyJobs, parseCareersUrl, SUPPORTED_ATS, type CompanyRef } from '../sources/ats';

// Usage :
//   npx tsx src/tools/add-company.ts --email moi@x.fr --name "Back Market"
//   npx tsx src/tools/add-company.ts --email moi@x.fr --name NVIDIA --url https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      url: { type: 'string' }, // facultatif : URL de la page carrières (obligatoire pour Workday)
    },
  });
  if (!values.email || !values.name) {
    throw new Error('Usage : --email <email> --name <entreprise> [--url <page carrières>]');
  }

  const [user] = await db.select().from(users).where(eq(users.email, values.email));
  if (!user) throw new Error(`Aucun utilisateur ${values.email} : lance d'abord upsert-user`);

  let found: { ref: CompanyRef; jobCount: number } | null = null;
  if (values.url) {
    const parsed = parseCareersUrl(values.url);
    if (!parsed) throw new Error(`URL non reconnue. ATS pris en charge : ${SUPPORTED_ATS.join(', ')}`);
    const ref = { name: values.name, ...parsed };
    const jobs = await fetchCompanyJobs(ref, { maxJobs: 0 });
    found = jobs ? { ref, jobCount: jobs.length } : null;
  } else {
    console.log(`🔍 Recherche de "${values.name}" sur les ATS devinables...`);
    found = await detectAts(values.name);
  }

  if (!found) {
    console.log(`❌ Aucun flux public trouvé pour "${values.name}". Elle restera couverte par Adzuna.`);
    console.log('   Si tu connais l\'URL de sa page carrières, relance avec --url.');
    return;
  }

  const { ref, jobCount } = found;
  await db
    .insert(companies)
    .values({ userId: user.id, name: ref.name, ats: ref.ats, slug: ref.slug })
    .onConflictDoNothing(); // déjà suivie : rien à faire

  console.log(`✅ ${ref.name} ajoutée : ${ref.ats} (slug "${ref.slug}")${jobCount ? `, ${jobCount} offres ouvertes` : ''}`);
}

main()
  .catch(err => {
    console.error('ERREUR :', (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

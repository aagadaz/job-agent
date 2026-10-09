import 'dotenv/config';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { users, companies } from '../db/schema';
import { detectAts, fetchCompanyJobs, type Ats } from '../sources/ats';

// Usage :
//   npx tsx src/tools/add-company.ts --email moi@x.fr --name "Back Market"
//   npx tsx src/tools/add-company.ts --email moi@x.fr --name Doctolib --ats greenhouse --slug doctolib

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      ats: { type: 'string' },  // facultatif : force l'ATS si la détection échoue
      slug: { type: 'string' }, // facultatif : identifiant exact chez l'ATS
    },
  });
  if (!values.email || !values.name) {
    throw new Error('Usage : --email <email> --name <entreprise> [--ats greenhouse|lever|ashby --slug <identifiant>]');
  }

  const [user] = await db.select().from(users).where(eq(users.email, values.email));
  if (!user) throw new Error(`Aucun utilisateur ${values.email} : lance d'abord upsert-user`);

  let found: { ref: { name: string; ats: Ats; slug: string }; jobCount: number } | null;
  if (values.ats && values.slug) {
    const ref = { name: values.name, ats: values.ats as Ats, slug: values.slug };
    const jobs = await fetchCompanyJobs(ref);
    found = jobs ? { ref, jobCount: jobs.length } : null;
  } else {
    console.log(`🔍 Recherche de "${values.name}" sur Greenhouse, Lever et Ashby...`);
    found = await detectAts(values.name);
  }

  if (!found) {
    console.log(`❌ Aucun flux public trouvé pour "${values.name}". Elle restera couverte par Adzuna.`);
    console.log('   Si tu connais l\'URL de sa page carrières, relance avec --ats et --slug.');
    return;
  }

  const { ref, jobCount } = found;
  await db
    .insert(companies)
    .values({ userId: user.id, name: ref.name, ats: ref.ats, slug: ref.slug })
    .onConflictDoNothing(); // déjà suivie : rien à faire

  console.log(`✅ ${ref.name} détectée sur ${ref.ats} (slug "${ref.slug}"), ${jobCount} offres ouvertes`);
}

main()
  .catch(err => {
    console.error('ERREUR :', (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

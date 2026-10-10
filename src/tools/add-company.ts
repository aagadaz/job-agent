import 'dotenv/config';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { users, companies } from '../db/schema';
import { resolveCompany } from '../sources/ats';

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

  if (!values.url) console.log(`🔍 Recherche de "${values.name}" sur les ATS devinables...`);
  const result = await resolveCompany(values.name, values.url);
  if (!result.ok) {
    console.log(`❌ "${values.name}" : ${result.reason}. Elle restera couverte par Adzuna.`);
    console.log('   Si tu connais l\'URL de sa page carrières, relance avec --url.');
    return;
  }
  const found = result;

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

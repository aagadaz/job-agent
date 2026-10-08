import 'dotenv/config';
import { db, pool } from './client';
import { users, profiles } from './schema';
import { extractCVText } from '../lib/cv-analyzer';

// Crée (ou met à jour) ton utilisateur et ton profil à partir de ta config actuelle.
// Idempotent : on peut le relancer sans créer de doublon.
const EMAIL = process.env.SEED_EMAIL;
const CV_PATH = process.env.CV_PATH ?? './CV_AfzalAgadazi.pdf';

async function main() {
  if (!EMAIL) throw new Error('SEED_EMAIL doit être défini dans .env');

  const cvText = await extractCVText(CV_PATH);

  const [user] = await db
    .insert(users)
    .values({ email: EMAIL, name: 'Afzal' })
    .onConflictDoUpdate({ target: users.email, set: { name: 'Afzal' } })
    .returning();

  await db
    .insert(profiles)
    .values({
      userId: user.id,
      location: 'Paris',
      excludeTerms: ['senior', 'lead', 'principal', 'staff', 'head of', 'director'],
      rejectThreshold: Number(process.env.SCORE_REJECT_THRESHOLD ?? 35),
      cvText,
    })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: { cvText, updatedAt: new Date() },
    });

  console.log(`✅ Utilisateur ${user.email} (${user.id}) et profil prêts`);
}

main()
  .catch(err => {
    console.error('ERREUR :', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end()); // ferme les connexions, sinon Node ne s'arrête pas
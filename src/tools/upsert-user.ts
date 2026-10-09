import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import Anthropic from '@anthropic-ai/sdk';
import { db, pool } from '../db/client';
import { users, profiles } from '../db/schema';
import { encrypt, maskSecret } from '../lib/crypto';
import { extractCVText } from '../lib/cv-analyzer';

// Usage : npm run user:upsert -- --email x@y.fr --name Marie --cv ./cv-marie.pdf
// La clé Claude est demandée de façon interactive : elle ne passe jamais dans la ligne de commande.

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      cv: { type: 'string' },
      location: { type: 'string', default: 'Paris' },
    },
  });
  if (!values.email || !values.cv) {
    throw new Error('Usage : npm run user:upsert -- --email <email> --cv <chemin du PDF> [--name <nom>] [--location <ville>]');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const apiKey = (await rl.question('Clé API Claude (sk-ant-...) : ')).trim();
  rl.close();

  // On vérifie la clé AVANT de la stocker : models.list() est un appel gratuit
  await new Anthropic({ apiKey }).models.list({ limit: 1 });
  console.log(`🔑 Clé valide (${maskSecret(apiKey)})`);

  const cvText = await extractCVText(values.cv);

  const [user] = await db
    .insert(users)
    .values({ email: values.email, name: values.name, anthropicKeyEncrypted: encrypt(apiKey) })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: values.name, anthropicKeyEncrypted: encrypt(apiKey) },
    })
    .returning();

  await db
    .insert(profiles)
    .values({
      userId: user.id,
      location: values.location!,
      excludeTerms: ['senior', 'lead', 'principal', 'staff', 'head of', 'director'],
      cvText,
    })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: { cvText, location: values.location!, updatedAt: new Date() },
    });

  console.log(`✅ ${user.email} prêt (${cvText.length} caractères de CV)`);
}

main()
  .catch(err => {
    console.error('ERREUR :', (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error('DATABASE_URL manquant (.env en local, secret GitHub en CI, variable Vercel en prod)');
}
// Validation de FORME au démarrage : une URL mal collée (guillemets, commande "psql '…'",
// "DATABASE_URL=" répété) serait sinon lue comme un chemin relatif, et pg tenterait de se
// connecter à un serveur nommé "base" (erreur EAI_AGAIN incompréhensible).
if (!/^postgres(ql)?:\/\//.test(connectionString)) {
  // On n'affiche que les premiers caractères : jamais le mot de passe
  throw new Error(
    `DATABASE_URL doit commencer par "postgresql://" (elle commence par "${connectionString.slice(0, 8)}…")`,
  );
}

// Un pool réutilise un petit nombre de connexions TCP au lieu d'en ouvrir une par requête.
export const pool = new Pool({ connectionString, max: 5 });
export const db = drizzle(pool, { schema });
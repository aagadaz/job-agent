import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL doit être défini dans .env');
}

// Un pool réutilise un petit nombre de connexions TCP au lieu d'en ouvrir une par requête.
export const pool = new Pool({ connectionString, max: 5 });
export const db = drizzle(pool, { schema });
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',                       // les fichiers SQL de migration, versionnés dans git
  dbCredentials: { url: process.env.DATABASE_URL! },
});
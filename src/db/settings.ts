import { z } from 'zod';
import { db } from './client';
import { appSettings } from './schema';

// Réglages de la plateforme. Le SCHÉMA zod est la source de vérité : il définit les clés,
// les types, les bornes ET les valeurs par défaut. Une valeur absente ou invalide en base
// retombe sur le défaut : un réglage corrompu ne peut pas casser l'application.
export const SettingsSchema = z.object({
  signupOpen: z.boolean().default(true),
  maxUsers: z.number().int().min(1).max(100).default(Number(process.env.MAX_USERS) || 4),
  maxScoredPerRun: z.number().int().min(10).max(500).default(150),
});
export type Settings = z.infer<typeof SettingsSchema>;

export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(appSettings);
  const raw = Object.fromEntries(rows.map(r => [r.key, r.value]));
  // Clé par clé : une seule valeur invalide n'invalide pas les autres
  const shape = SettingsSchema.shape;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape) as (keyof Settings)[]) {
    const parsed = shape[key].safeParse(raw[key]);
    out[key] = parsed.success ? parsed.data : shape[key].parse(undefined);
  }
  return out as Settings;
}

export async function saveSettings(values: Settings): Promise<void> {
  const now = new Date();
  await db.transaction(async tx => {
    for (const [key, value] of Object.entries(values)) {
      await tx
        .insert(appSettings)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
    }
  });
}

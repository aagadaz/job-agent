import Anthropic from '@anthropic-ai/sdk';
import { applyCompanyTypes, listCategories, prepareUntyped } from '@/db/applications';
import { getUserWithProfile } from '@/db/dashboard';
import { MAX_COMPANIES_PER_CALL, classifyCompanies } from './company-classifier';
import { decrypt } from './crypto';

// Orchestration du classement : (1) recopier les types déjà connus, (2) demander à Claude
// pour le reste, par lots, avec la clé de l'utilisateur, (3) écrire seulement les cases vides.
// Module serveur uniquement (importé par des server actions et la page) : la clé déchiffrée
// ne quitte jamais le serveur.

export type ClassifyOutcome =
  | { status: 'done'; classified: number; remaining: number }
  | { status: 'no_key' }
  | { status: 'nothing' };

const MAX_BATCHES = 3; // 120 entreprises max par passage : borne le coût et la durée

export async function classifyMissingTypes(userId: string): Promise<ClassifyOutcome> {
  const untyped = await prepareUntyped(userId);
  if (untyped.length === 0) return { status: 'nothing' };
  const account = await getUserWithProfile(userId);
  const encrypted = account?.user.anthropicKeyEncrypted;
  if (!encrypted) return { status: 'no_key' };

  const client = new Anthropic({ apiKey: decrypt(encrypted) });
  let classified = 0;
  let done = 0;
  for (let b = 0; b < MAX_BATCHES && done < untyped.length; b++) {
    const batch = untyped.slice(done, done + MAX_COMPANIES_PER_CALL);
    done += batch.length;
    // Catégories relues à chaque lot : celles créées au lot précédent sont réutilisées
    const types = await classifyCompanies(client, batch, await listCategories(userId));
    classified += await applyCompanyTypes(userId, types);
  }
  return { status: 'done', classified, remaining: Math.max(0, untyped.length - done) };
}

/** Version « en arrière-plan » : ne lève jamais (les erreurs vont dans les logs). */
export async function classifyInBackground(userId: string): Promise<void> {
  try {
    await classifyMissingTypes(userId);
  } catch (err) {
    console.error('[company-types]', err instanceof Error ? err.message : err);
  }
}

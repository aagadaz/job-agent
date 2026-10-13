import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db } from './client';
import { loginTokens } from './schema';

const TOKEN_TTL_MS = 15 * 60_000;      // un lien vaut 15 minutes
const MAX_LINKS_PER_WINDOW = 3;        // au plus 3 liens par adresse…
const WINDOW_MS = 15 * 60_000;         // …par quart d'heure (anti-spam de boîte mail)

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Crée un jeton pour cette adresse et le renvoie EN CLAIR (il partira dans l'e-mail) ;
 * seule son empreinte est stockée. null si la limite d'envoi est atteinte.
 */
export async function createLoginToken(email: string): Promise<string | null> {
  // Ménage : les jetons expirés ne servent plus à rien
  await db.delete(loginTokens).where(lt(loginTokens.expiresAt, new Date()));

  const since = new Date(Date.now() - WINDOW_MS);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginTokens)
    .where(and(eq(loginTokens.email, email), gt(loginTokens.createdAt, since)));
  if (n >= MAX_LINKS_PER_WINDOW) return null;

  const token = randomBytes(32).toString('base64url'); // 256 bits d'aléa : impossible à deviner
  await db.insert(loginTokens).values({ email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) });
  return token;
}

/**
 * Consomme un jeton et renvoie l'adresse e-mail associée, ou null s'il est inconnu, expiré
 * ou déjà utilisé. L'UPDATE … WHERE used_at IS NULL … RETURNING est ATOMIQUE : si le même
 * lien est cliqué deux fois en même temps, une seule requête trouve la ligne encore libre.
 * (L'e-mail n'est pas dans le lien : il est retrouvé via le jeton, rien de personnel dans l'URL.)
 */
export async function consumeLoginToken(token: string): Promise<string | null> {
  const rows = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(
      eq(loginTokens.tokenHash, sha256(token)),
      isNull(loginTokens.usedAt),
      gt(loginTokens.expiresAt, new Date()),
    ))
    .returning({ email: loginTokens.email });
  return rows[0]?.email ?? null;
}

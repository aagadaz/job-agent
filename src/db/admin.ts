import { desc, eq, sql } from 'drizzle-orm';
import { db } from './client';
import { profiles, runs, userOffers, users } from './schema';

// Requêtes réservées à la page /admin. Contrairement au reste de l'interface, elles ne sont
// PAS filtrées par utilisateur : elles ne doivent être appelées qu'après vérification isAdmin().

export async function listUsersWithStats() {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      hasKey: sql<boolean>`${users.anthropicKeyEncrypted} is not null`,
      hasCv: sql<boolean>`${profiles.cvText} is not null`,
      offers: sql<number>`(select count(*)::int from ${userOffers} where ${userOffers.userId} = ${users.id} and ${userOffers.dismissedAt} is null)`,
      lastRunAt: sql<Date | null>`(select max(${runs.startedAt}) from ${runs} where ${runs.userId} = ${users.id})`,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .orderBy(users.createdAt);
}

export async function recentRuns(limit = 20) {
  return db
    .select({
      id: runs.id,
      email: users.email,
      status: runs.status,
      stats: runs.stats,
      error: runs.error,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .innerJoin(users, eq(users.id, runs.userId))
    .orderBy(desc(runs.startedAt))
    .limit(limit);
}

/** Supprime un compte et TOUTES ses données (profil, entreprises, offres notées, exécutions : ON DELETE CASCADE). */
export async function deleteUserAccount(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

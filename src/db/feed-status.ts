import { sql } from 'drizzle-orm';
import { applications, userOffers } from './schema';

/**
 * Condition « offre encore à traiter » : aucune candidature liée pour cet utilisateur.
 * Remplace l'ancien statut stocké sur user_offers (une seule source de vérité : applications).
 * Utilisable dans un SELECT comme dans un UPDATE sur user_offers.
 */
export const noApplication = sql`not exists (
  select 1 from ${applications}
  where ${applications.userId} = ${userOffers.userId} and ${applications.offerId} = ${userOffers.offerId}
)`;

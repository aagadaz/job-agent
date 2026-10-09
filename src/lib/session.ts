import { redirect } from 'next/navigation';
import { auth } from '../auth';

/**
 * Renvoie l'id de l'utilisateur connecté, ou redirige vers /login.
 * À appeler en tête de CHAQUE page protégée et de CHAQUE server action.
 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  return session.user.id;
}

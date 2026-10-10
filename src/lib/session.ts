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

/**
 * L'utilisateur connecté est-il administrateur (ADMIN_EMAILS, séparés par des virgules) ?
 * Sert à afficher les détails techniques des erreurs, que les autres utilisateurs ne voient pas.
 */
export async function isAdmin(): Promise<boolean> {
  const email = (await auth())?.user?.email?.toLowerCase();
  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return !!email && admins.includes(email);
}

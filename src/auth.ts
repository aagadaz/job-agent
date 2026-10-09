import NextAuth, { type DefaultSession } from 'next-auth';
import Google from 'next-auth/providers/google';
import { ensureUser, findUserIdByEmail } from './db/dashboard';

// La session expose l'id de l'utilisateur en base (pas seulement son e-mail).
declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}

/** Liste blanche : seuls ces e-mails peuvent se connecter (variable ALLOWED_EMAILS, séparés par des virgules). */
function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google], // lit AUTH_GOOGLE_ID et AUTH_GOOGLE_SECRET
  session: { strategy: 'jwt' }, // session dans un cookie signé : aucune table de session en base
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    // 1. Autorisation : refuser tout e-mail hors liste blanche
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email || !allowedEmails().includes(email)) return false;
      await ensureUser(email, user.name ?? null); // crée la ligne users au premier login
      return true;
    },
    // 2. À la connexion, on mémorise l'id en base dans le jeton
    async jwt({ token, user }) {
      if (user?.email) token.uid = await findUserIdByEmail(user.email.toLowerCase());
      return token;
    },
    // 3. On l'expose dans la session lue par les pages
    session({ session, token }) {
      if (typeof token.uid === 'string') session.user.id = token.uid;
      return session;
    },
  },
});

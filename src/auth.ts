import NextAuth, { type DefaultSession } from 'next-auth';
import Google from 'next-auth/providers/google';
import { admitUser, findUserIdByEmail } from './db/dashboard';

// La session expose l'id de l'utilisateur en base (pas seulement son e-mail).
declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}

/** Nombre maximum de comptes (variable MAX_USERS, 4 par défaut) : protège les quotas partagés. */
function maxUsers(): number {
  const n = Number(process.env.MAX_USERS ?? 4);
  return Number.isInteger(n) && n > 0 ? n : 4;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google], // lit AUTH_GOOGLE_ID et AUTH_GOOGLE_SECRET
  session: { strategy: 'jwt' }, // session dans un cookie signé : aucune table de session en base
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    // 1. Inscription libre, dans la limite des places : un compte existant entre toujours,
    //    un nouveau compte est créé s'il reste de la place, sinon renvoyé vers /login?error=full
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      const result = await admitUser(email, user.name ?? null, maxUsers());
      return result === 'full' ? '/login?error=full' : true;
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

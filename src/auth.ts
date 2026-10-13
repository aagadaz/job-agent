import NextAuth, { type DefaultSession } from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { consumeLoginToken } from './db/login-tokens';
import { admitUser, findUserIdByEmail } from './db/dashboard';
import { getSettings } from './db/settings';

// La session expose l'id de l'utilisateur en base (pas seulement son e-mail).
declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}


export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google,
    // Lien magique : le « mot de passe » est un jeton à usage unique reçu par e-mail.
    // authorize() ne renvoie un utilisateur que si le jeton est valide ; ensuite les MÊMES
    // callbacks que Google s'appliquent (plafond d'inscriptions, id interne dans le JWT).
    Credentials({
      id: 'magic-link',
      credentials: { token: {} },
      async authorize(credentials) {
        const token = typeof credentials?.token === 'string' ? credentials.token : '';
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null; // 32 octets en base64url = 43 caractères
        const email = await consumeLoginToken(token);
        return email ? { email } : null;
      },
    }),
  ], // lit AUTH_GOOGLE_ID et AUTH_GOOGLE_SECRET
  session: { strategy: 'jwt' }, // session dans un cookie signé : aucune table de session en base
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    // 1. Inscription libre, dans la limite des places : un compte existant entre toujours,
    //    un nouveau compte est créé s'il reste de la place, sinon renvoyé vers /login?error=full
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      // Réglages lus en base à chaque connexion (modifiables depuis /admin) ;
      // inscriptions fermées = plafond à 0 : les comptes existants entrent toujours.
      const { signupOpen, maxUsers } = await getSettings();
      const result = await admitUser(email, user.name ?? null, signupOpen ? maxUsers : 0);
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

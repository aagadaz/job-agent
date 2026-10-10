import Link from 'next/link';
import { auth, signOut } from '@/auth';
import { isAdmin, requireUserId } from '@/lib/session';

const NAV = [
  { href: '/offers', label: 'Offres' },
  { href: '/companies', label: 'Entreprises' },
  { href: '/profile', label: 'Profil' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUserId(); // toutes les pages de ce groupe exigent une connexion
  const session = await auth();
  const admin = await isAdmin(); // le lien n'est rendu que pour un admin (la page se protège elle-même)

  return (
    <>
      <header className="border-b bg-white">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3 text-sm">
          <span className="font-semibold">job-agent</span>
          {NAV.map(item => (
            <Link key={item.href} href={item.href} className="text-gray-600 hover:text-gray-900">
              {item.label}
            </Link>
          ))}
          {admin && (
            <Link href="/admin" className="text-gray-600 hover:text-gray-900">
              Admin
            </Link>
          )}
          <form
            className="ml-auto flex items-center gap-3"
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <span className="text-gray-500">{session?.user?.email}</span>
            <button className="text-gray-600 hover:text-gray-900">Déconnexion</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </>
  );
}

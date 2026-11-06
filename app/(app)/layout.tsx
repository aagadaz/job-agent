import Link from 'next/link';
import { auth, signOut } from '@/auth';
import { isAdmin, requireUserId } from '@/lib/session';
import { countNewOffers } from '@/db/dashboard';
import { NavLinks, type NavItem } from '../components/NavLinks';
import { ThemeToggle } from '../components/ThemeToggle';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUserId(); // toutes les pages de ce groupe exigent une connexion
  const [session, admin, fresh] = await Promise.all([auth(), isAdmin(), countNewOffers(userId)]);

  const items: NavItem[] = [
    { href: '/offers', label: 'Offres', icon: 'offers', badge: fresh },
    { href: '/applications', label: 'Candidatures', icon: 'applications' },
    { href: '/companies', label: 'Entreprises', icon: 'companies' },
    { href: '/profile', label: 'Profil', icon: 'profile' },
    // Le lien n'est rendu que pour un admin (la page se protège elle-même de toute façon)
    ...(admin ? [{ href: '/admin', label: 'Admin', icon: 'admin' } as NavItem] : []),
  ];

  return (
    <>
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2 text-sm sm:px-6">
          <Link href="/offers" className="mr-3 flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-gray-900 text-xs font-bold text-white">ja</span>
            <span className="hidden md:inline">job-agent</span>
          </Link>
          <NavLinks items={items} />
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden max-w-48 truncate px-2 text-gray-500 lg:inline">{session?.user?.email}</span>
            <ThemeToggle />
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <button className="rounded-md px-3 py-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900">Déconnexion</button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}

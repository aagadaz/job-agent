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
      {/* pt-safe : sous l'encoche / la Dynamic Island quand l'app est ouverte depuis l'écran d'accueil */}
      <header className="sticky top-0 z-10 border-b bg-white/80 pt-[env(safe-area-inset-top)] backdrop-blur">
        <nav className="mx-auto flex h-12 max-w-6xl items-center gap-1 px-4 text-sm sm:px-6">
          <Link href="/offers" className="mr-3 flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-gray-900 text-xs font-bold text-white">ja</span>
            {/* Nom visible sur téléphone (les onglets sont en bas) et sur grand écran, masqué entre les deux */}
            <span className="inline sm:hidden lg:inline">job-agent</span>
          </Link>
          <div className="hidden sm:contents">
            <NavLinks items={items} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden max-w-48 truncate px-2 text-gray-500 xl:inline">{session?.user?.email}</span>
            <ThemeToggle />
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <button
                className="flex items-center rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 lg:px-3 lg:py-1.5"
                aria-label="Déconnexion"
                title="Déconnexion"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="lg:hidden">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                <span className="hidden lg:inline">Déconnexion</span>
              </button>
            </form>
          </div>
        </nav>
      </header>
      {/* Sur téléphone, de la place en bas pour la barre d'onglets (et la barre d'accueil de l'iPhone) */}
      <main className="mx-auto max-w-6xl px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:py-8">{children}</main>
      {/* Barre d'onglets en bas, à portée de pouce : téléphones uniquement */}
      <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        <NavLinks items={items} variant="tabbar" />
      </nav>
    </>
  );
}

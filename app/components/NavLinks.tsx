'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Icônes en SVG inline (pas de bibliothèque) : 4 tracés simples, aucune requête réseau
const ICONS: Record<string, React.ReactNode> = {
  offers: <path d="M4 7h16M4 12h16M4 17h10" />,
  companies: <><path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 21v-4h6v4M9 10h.01M15 10h.01M9 14h.01M15 14h.01" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  admin: <><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path d="M9 12l2 2 4-4" /></>,
};

export interface NavItem { href: string; label: string; icon: keyof typeof ICONS; badge?: number }

/** Liens de navigation avec l'onglet actif mis en évidence (d'où le composant client : usePathname). */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map(item => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 ${active ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {ICONS[item.icon]}
            </svg>
            <span className="hidden sm:inline">{item.label}</span>
            {!!item.badge && (
              <span className="rounded-full bg-blue-600 px-1.5 text-xs font-semibold leading-5 text-white" title={`${item.badge} nouvelle(s) offre(s) depuis 24 h`}>
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}

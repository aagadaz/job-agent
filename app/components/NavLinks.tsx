'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Icônes en SVG inline (pas de bibliothèque) : 4 tracés simples, aucune requête réseau
const ICONS: Record<string, React.ReactNode> = {
  offers: <path d="M4 7h16M4 12h16M4 17h10" />,
  applications: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  companies: <><path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 21v-4h6v4M9 10h.01M15 10h.01M9 14h.01M15 14h.01" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  admin: <><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path d="M9 12l2 2 4-4" /></>,
};

export interface NavItem { href: string; label: string; icon: keyof typeof ICONS; badge?: number }

/**
 * Liens de navigation avec l'onglet actif mis en évidence (d'où le composant client : usePathname).
 * variant « bar » : en-tête (tablette et ordinateur) ; « tabbar » : barre d'onglets en bas d'écran
 * sur téléphone, icône au-dessus du libellé, cibles de toucher larges.
 */
export function NavLinks({ items, variant = 'bar' }: { items: NavItem[]; variant?: 'bar' | 'tabbar' }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const icon = (item: NavItem) => (
    <svg width={variant === 'tabbar' ? 22 : 16} height={variant === 'tabbar' ? 22 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[item.icon]}
    </svg>
  );
  const badgeTitle = (n: number) => `${n} nouvelle(s) offre(s) depuis 24 h`;

  if (variant === 'tabbar') {
    return (
      <ul className="flex">
        {items.map(item => {
          const active = isActive(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-12 flex-col items-center justify-center gap-0.5 pb-1 pt-1.5 text-[11px] ${active ? 'font-semibold text-gray-900' : 'text-gray-500'}`}
              >
                {icon(item)}
                {item.label}
                {!!item.badge && (
                  <span className="absolute left-1/2 top-0.5 ml-2 rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold leading-4 text-white" title={badgeTitle(item.badge)}>
                    {item.badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <>
      {items.map(item => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            title={item.label}
            className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 lg:px-3 ${active ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`}
          >
            {icon(item)}
            {/* Libellé visible sur grand écran ; entre 640 et 1024 px (tablette, iPhone en paysage),
                icônes seules pour que l'en-tête tienne, libellé gardé pour les lecteurs d'écran */}
            <span className="sr-only lg:not-sr-only">{item.label}</span>
            {!!item.badge && (
              <span className="rounded-full bg-blue-600 px-1.5 text-xs font-semibold leading-5 text-white" title={badgeTitle(item.badge)}>
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}

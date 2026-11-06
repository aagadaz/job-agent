'use client';

import type { ReactNode } from 'react';

/**
 * Formulaire GET qui se soumet tout seul à chaque case cochée ou liste changée : les filtres
 * s'appliquent immédiatement, et l'URL (partageable, rafraîchissable) reste la source de vérité.
 * Le champ de recherche texte, lui, attend la touche Entrée (pas de rechargement à chaque lettre).
 */
export function AutoSubmitForm({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <form
      method="get"
      action="/offers"
      className={className}
      onChange={e => {
        const target = e.target;
        if (target instanceof HTMLInputElement && (target.type === 'search' || target.type === 'text')) return;
        e.currentTarget.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}

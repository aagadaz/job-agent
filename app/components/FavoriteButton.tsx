'use client';

import { useOptimistic, useTransition } from 'react';
import { favoriteOffer } from '../actions';

/**
 * Étoile « favori ». L'affichage change tout de suite au clic (état optimiste), puis le serveur
 * confirme ; en cas d'échec, React revient tout seul à l'état réel.
 */
export function FavoriteButton({ offerId, favorite, withLabel = false }: { offerId: string; favorite: boolean; withLabel?: boolean }) {
  const [shown, setShown] = useOptimistic(favorite);
  const [, startTransition] = useTransition();
  const label = shown ? 'Retirer des favoris' : 'Ajouter aux favoris';

  return (
    <button
      type="button"
      onClick={() => startTransition(async () => {
        setShown(!shown);
        await favoriteOffer(offerId, !shown);
      })}
      aria-pressed={shown}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-md text-sm ${withLabel ? 'border px-2.5' : ''} ${shown ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'}`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill={shown ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
        <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
      </svg>
      {withLabel && <span className={shown ? 'text-gray-900' : 'text-gray-600'}>{shown ? 'Favori' : 'Mettre en favori'}</span>}
    </button>
  );
}

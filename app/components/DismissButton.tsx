'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { dismissOffer } from '../actions';

/** Supprime une offre du fil (suppression logique), ou la restaure depuis la corbeille. */
export function DismissButton({ offerId, dismissed, redirectTo }: { offerId: string; dismissed: boolean; redirectTo?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await dismissOffer(offerId, !dismissed);
          if (redirectTo) router.push(redirectTo); // depuis la fiche : retour à la liste
        })
      }
      className={`text-xs hover:underline disabled:opacity-50 ${dismissed ? 'text-blue-700' : 'text-gray-500 hover:text-red-600'}`}
    >
      {pending ? '…' : dismissed ? 'Restaurer' : 'Supprimer du fil'}
    </button>
  );
}

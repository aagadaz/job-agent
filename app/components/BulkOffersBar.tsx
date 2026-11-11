'use client';

import { useActionState, useEffect, useState } from 'react';
import { bulkOffers } from '../actions';
import { STAGES, STAGE_KEYS } from '@/lib/applications';
import { ResultMessage } from './ResultMessage';

// Les cases à cocher sont rendues par la page (composant serveur) dans chaque offre, avec
// form="bulk-offers" : elles appartiennent à CE formulaire sans être à l'intérieur.
export const BULK_FORM_ID = 'bulk-offers';
const boxes = () => document.querySelectorAll<HTMLInputElement>(`input[form="${BULK_FORM_ID}"][name="ids"]`);

/** Barre d'actions groupées du fil : écarter, restaurer ou changer l'étape des offres cochées. */
export function BulkOffersBar({ dismissed }: { dismissed: boolean }) {
  const [result, action, pending] = useActionState(bulkOffers, null);
  const [count, setCount] = useState(0);
  const recount = () => setCount([...boxes()].filter(b => b.checked).length);

  useEffect(() => {
    document.addEventListener('change', recount);
    return () => document.removeEventListener('change', recount);
  }, []);
  // Action réussie : on décoche tout (la page vient d'être rafraîchie par le serveur)
  useEffect(() => {
    if (!result?.ok) return;
    boxes().forEach(b => { b.checked = false; });
    setCount(0);
  }, [result]);

  const toggleAll = (on: boolean) => {
    boxes().forEach(b => { b.checked = on; });
    recount();
  };

  return (
    <form id={BULK_FORM_ID} action={action} className="sticky top-[calc(3rem+1px+env(safe-area-inset-top))] z-[5] flex flex-wrap items-center gap-2 rounded-xl border bg-white/95 px-4 py-2 text-sm backdrop-blur">
      <label className="flex items-center gap-2">
        <input type="checkbox" className="size-4 accent-gray-900" checked={count > 0} onChange={e => toggleAll(e.target.checked)} aria-label="Tout cocher sur cette page" />
        {count > 0 ? `${count} sélectionnée${count > 1 ? 's' : ''}` : 'Tout cocher'}
      </label>
      {count > 0 && (
        <>
          <select name="op" defaultValue={dismissed ? 'restore' : 'dismiss'} className="rounded-md border px-2 py-1">
            {dismissed ? (
              <option value="restore">Restaurer dans le fil</option>
            ) : (
              <>
                <option value="dismiss">Mettre à la corbeille</option>
                {STAGE_KEYS.map(s => <option key={s} value={s}>Passer en « {STAGES[s].label} »</option>)}
              </>
            )}
          </select>
          <button disabled={pending} className="rounded-md bg-gray-900 px-3 py-1 font-medium text-white disabled:opacity-50">
            {pending ? 'En cours…' : 'Appliquer'}
          </button>
        </>
      )}
      <ResultMessage result={result} />
    </form>
  );
}

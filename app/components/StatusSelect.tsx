'use client';

import { useState, useTransition } from 'react';
import { changeStatus } from '../actions';
import { STAGES, STAGE_KEYS } from '@/lib/applications';
import type { FeedStatus } from '@/lib/status';

/**
 * Statut d'une offre = étape de sa candidature. « À traiter » n'est proposé que tant qu'aucune
 * candidature n'existe : pour revenir en arrière, on supprime la candidature (onglet
 * Candidatures), ce qui évite d'effacer ses notes par un simple changement de liste.
 */
export function StatusSelect({ offerId, status }: { offerId: string; status: FeedStatus }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        defaultValue={status}
        disabled={pending}
        aria-label="Statut de la candidature"
        onChange={e => {
          const next = e.target.value;
          startTransition(async () => {
            setFeedback(await changeStatus(offerId, next));
          });
        }}
        className="rounded-md border px-2 py-1 text-sm disabled:opacity-50"
      >
        {status === 'a_traiter' && <option value="a_traiter" disabled>À traiter</option>}
        {STAGE_KEYS.map(s => (
          <option key={s} value={s}>{STAGES[s].label}</option>
        ))}
      </select>
      {feedback?.message && (
        <span className={`max-w-56 text-right text-xs ${feedback.ok ? 'text-green-700' : 'text-red-600'}`}>
          {feedback.message}
        </span>
      )}
    </div>
  );
}

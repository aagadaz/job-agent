'use client';

import { useActionState } from 'react';
import { triggerSearch } from '../actions';

export function RunSearchButton({ running }: { running: boolean }) {
  const [result, formAction, pending] = useActionState(triggerSearch, null);
  // L'état « en cours » vient du serveur (prop running), rafraîchi par RunWatcher : dès que la
  // recherche se termine, le bouton redevient actif sans recharger la page.
  const disabled = pending || running;

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <button
        disabled={disabled}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Lancement…' : running ? 'Recherche en cours…' : 'Lancer une recherche'}
      </button>
      {result?.message && !(result.ok && !running) && (
        <span className={`text-xs ${result.ok ? 'text-green-700' : 'text-red-600'}`}>{result.message}</span>
      )}
    </form>
  );
}

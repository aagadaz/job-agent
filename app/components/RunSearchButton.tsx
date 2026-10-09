'use client';

import { useActionState } from 'react';
import { triggerSearch } from '../actions';

export function RunSearchButton({ running }: { running: boolean }) {
  const [result, formAction, pending] = useActionState(triggerSearch, null);
  const disabled = pending || running || result?.ok === true;

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <button
        disabled={disabled}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Lancement…' : running ? 'Recherche en cours…' : 'Lancer une recherche'}
      </button>
      {result?.message && (
        <span className={`text-xs ${result.ok ? 'text-green-700' : 'text-red-600'}`}>{result.message}</span>
      )}
    </form>
  );
}

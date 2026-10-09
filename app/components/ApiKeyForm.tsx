'use client';

import { useActionState } from 'react';
import { updateApiKey } from '../actions';
import { ResultMessage } from './ResultMessage';

export function ApiKeyForm({ masked }: { masked: string | null }) {
  const [result, formAction, pending] = useActionState(updateApiKey, null);

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-sm text-gray-600">
        {masked ? <>Clé actuelle : <code>{masked}</code></> : 'Aucune clé enregistrée : le worker ne te traitera pas.'}
      </p>
      <input
        name="apiKey"
        type="password"
        autoComplete="off"
        placeholder="sk-ant-..."
        required
        className="w-full rounded-md border px-3 py-2 text-sm"
      />
      <button disabled={pending} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? 'Vérification…' : masked ? 'Remplacer la clé' : 'Enregistrer la clé'}
      </button>
      <ResultMessage result={result} />
    </form>
  );
}

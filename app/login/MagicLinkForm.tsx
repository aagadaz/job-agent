'use client';

import { useActionState } from 'react';
import { requestMagicLink } from './actions';

export function MagicLinkForm() {
  const [state, action, pending] = useActionState(requestMagicLink, null);
  return (
    <form action={action} className="space-y-2">
      <label htmlFor="email" className="block text-sm font-medium text-gray-700">Recevoir un lien par e-mail</label>
      <input
        id="email" name="email" type="email" required autoComplete="email" placeholder="toi@exemple.com"
        className="w-full rounded-md border px-3 py-2 text-sm"
      />
      <button
        disabled={pending}
        className="w-full rounded-md border border-gray-900 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? 'Envoi…' : 'Envoyer le lien de connexion'}
      </button>
      {state && (
        <p className={`rounded-md p-3 text-sm ${state.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}

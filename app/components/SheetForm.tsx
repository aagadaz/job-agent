'use client';

import { useActionState } from 'react';
import { updateSheet } from '../actions';
import { ResultMessage } from './ResultMessage';

export function SheetForm({ currentUrl, serviceEmail }: { currentUrl: string; serviceEmail: string | null }) {
  const [result, formAction, pending] = useActionState(updateSheet, null);

  if (!serviceEmail) {
    return <p className="text-sm text-red-600">Compte de service Google non configuré sur le serveur (GOOGLE_CREDENTIALS_JSON).</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-600">
        <li>Crée (ou ouvre) un Google Sheet.</li>
        <li>
          Bouton <b>Partager</b> → ajoute <code className="rounded bg-gray-100 px-1 text-xs break-all">{serviceEmail}</code> en <b>Éditeur</b>.
        </li>
        <li>Colle l&apos;URL du Sheet ci-dessous (vide = désactiver).</li>
      </ol>
      <input
        name="sheetUrl"
        defaultValue={currentUrl}
        placeholder="https://docs.google.com/spreadsheets/d/…"
        className="w-full rounded-md border px-3 py-2 text-sm"
      />
      <button disabled={pending} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? 'Vérification…' : 'Connecter le Sheet'}
      </button>
      <ResultMessage result={result} />
    </form>
  );
}

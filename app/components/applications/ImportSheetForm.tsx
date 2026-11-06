'use client';

import { useActionState } from 'react';
import { importSheet } from '../../applications-actions';
import { ResultMessage } from '../ResultMessage';

/**
 * Import des lignes déjà présentes dans le Google Sheet de suivi. Champ vide = l'onglet
 * connecté dans le Profil. Relançable : les lignes déjà importées sont ignorées.
 */
export function ImportSheetForm({ connectedTab }: { connectedTab: boolean }) {
  const [result, action, pending] = useActionState(importSheet, null);
  return (
    <form action={action}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="sheetUrl"
          type="url"
          placeholder={connectedTab ? 'Onglet du Profil — ou colle l’URL d’un autre onglet (#gid=…)' : 'URL de l’onglet de suivi (…/edit#gid=…)'}
          className="min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-sm"
        />
        <button disabled={pending} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {pending ? 'Import…' : 'Importer'}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-gray-500">
        Colonnes reconnues : Entreprise, Type d&apos;entreprise, Poste (et son lien), Type, Réponses, Last contact, Notes, Contact.
        Les lignes déjà présentes sont ignorées, tu peux relancer l&apos;import.
      </p>
      <ResultMessage result={result} />
    </form>
  );
}

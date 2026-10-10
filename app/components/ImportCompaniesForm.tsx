'use client';

import { useActionState } from 'react';
import { importCompanies } from '../actions';

export function ImportCompaniesForm() {
  const [result, formAction, pending] = useActionState(importCompanies, null);

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-sm text-gray-600">
        Un fichier <b>.csv</b> ou <b>.txt</b>, une entreprise par ligne : <code className="rounded bg-gray-100 px-1">nom</code>{' '}
        ou <code className="rounded bg-gray-100 px-1">nom,url_carrieres</code>. Séparateur « , » ou « ; » (export Excel).
        Les colonnes suivantes sont ignorées. 300 lignes maximum.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input name="file" type="file" accept=".csv,.txt,text/csv,text/plain" required className="text-sm" />
        <button disabled={pending} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? 'Import en cours… (jusqu’à 1 min)' : 'Importer'}
        </button>
      </div>

      {result && (
        <div className={`rounded-md border px-3 py-2 text-sm ${result.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          <p>{result.message}</p>
          {result.failed.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer">Entreprises non ajoutées ({result.failed.length})</summary>
              <ul className="mt-1 list-disc pl-5 text-gray-700">
                {result.failed.map(f => <li key={f.name}><b>{f.name}</b> : {f.reason}</li>)}
              </ul>
            </details>
          )}
          {result.pending.length > 0 && (
            <p className="mt-2 text-gray-700">Non traitées : {result.pending.join(', ')}</p>
          )}
        </div>
      )}
    </form>
  );
}

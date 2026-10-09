'use client';

import { useActionState } from 'react';
import { addCompany } from '../actions';
import { ResultMessage } from './ResultMessage';

export function CompanyForm() {
  const [result, formAction, pending] = useActionState(addCompany, null);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <input name="name" placeholder="Nom de l'entreprise" required className="w-56 rounded-md border px-3 py-2 text-sm" />
        <input
          name="careersUrl"
          placeholder="URL de la page carrières (facultatif, obligatoire pour Workday)"
          className="min-w-64 flex-1 rounded-md border px-3 py-2 text-sm"
        />
        <button disabled={pending} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? 'Recherche…' : 'Ajouter'}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Sans URL, l&apos;identifiant est deviné sur Greenhouse, Lever, Ashby, Workable, Recruitee et SmartRecruiters.
        Exemple Workday : https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite
      </p>
      <ResultMessage result={result} />
    </form>
  );
}

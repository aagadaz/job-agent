'use client';

import { useActionState } from 'react';
import { updateProfile } from '../actions';
import { ResultMessage } from './ResultMessage';

export interface ProfileFormValues {
  keywords: string;
  location: string;
  includeTerms: string;
  excludeTerms: string;
  rejectThreshold: number;
  cvChars: number;
}

const input = 'mt-1 w-full rounded-md border px-3 py-2 text-sm';

export function ProfileForm({ initial }: { initial: ProfileFormValues }) {
  const [result, formAction, pending] = useActionState(updateProfile, null);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block text-sm font-medium">
        Mots-clés de recherche <span className="font-normal text-gray-500">(séparés par des virgules ; vide = déduits du CV)</span>
        <input name="keywords" defaultValue={initial.keywords} className={input} />
      </label>
      <label className="block text-sm font-medium">
        Localisation
        <input name="location" defaultValue={initial.location} required className={input} />
      </label>
      <label className="block text-sm font-medium">
        L&apos;intitulé doit contenir l&apos;un de ces termes <span className="font-normal text-gray-500">(vide = pas de filtre)</span>
        <input name="includeTerms" defaultValue={initial.includeTerms} className={input} />
      </label>
      <label className="block text-sm font-medium">
        Exclure les intitulés contenant
        <input name="excludeTerms" defaultValue={initial.excludeTerms} className={input} />
      </label>
      <label className="block text-sm font-medium">
        Écarter les offres notées à ou sous
        <input name="rejectThreshold" type="number" min={0} max={100} defaultValue={initial.rejectThreshold} className={`${input} max-w-24`} />
      </label>
      <fieldset className="rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">CV</legend>
        <p className="text-sm text-gray-600">
          {initial.cvChars > 0 ? `CV enregistré (${initial.cvChars} caractères).` : 'Aucun CV enregistré : le worker ne te traitera pas.'}
        </p>
        <label className="mt-3 block text-sm">
          Remplacer par un PDF
          <input name="cvFile" type="file" accept="application/pdf" className="mt-1 block text-sm" />
        </label>
        <label className="mt-3 block text-sm">
          …ou coller le texte du CV
          <textarea name="cvText" rows={4} className={input} />
        </label>
      </fieldset>
      <button disabled={pending} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? 'Enregistrement…' : 'Enregistrer le profil'}
      </button>
      <ResultMessage result={result} />
    </form>
  );
}

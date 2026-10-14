'use client';

import { useActionState, useState } from 'react';
import { COUNTRIES, COUNTRY_CODES, type CountryCode, type SearchArea } from '@/lib/countries';
import { updateProfile } from '../actions';
import { ResultMessage } from './ResultMessage';

export interface ProfileFormValues {
  keywords: string;
  areas: SearchArea[];
  includeTerms: string;
  excludeTerms: string;
  rejectThreshold: number;
  maxExperienceYears: number | null;
  cvChars: number;
}

const input = 'mt-1 w-full rounded-md border px-3 py-2 text-sm';

export function ProfileForm({ initial }: { initial: ProfileFormValues }) {
  const [result, formAction, pending] = useActionState(updateProfile, null);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block text-sm font-medium">
        Mots-clés de recherche <span className="font-normal text-gray-500">(séparés par des virgules ; vide = déduits du CV par Claude, <b>obligatoires sans clé Claude</b>)</span>
        <input name="keywords" defaultValue={initial.keywords} className={input} />
      </label>
      <AreasField initial={initial.areas} />
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
      <label className="block text-sm font-medium">
        Écarter les offres exigeant plus de{' '}
        <input
          name="maxExperienceYears" type="number" min={0} max={30}
          defaultValue={initial.maxExperienceYears ?? ''}
          className="mx-1 w-20 rounded-md border px-3 py-2 text-sm"
        />
        ans d&apos;expérience <span className="font-normal text-gray-500">(vide = pas de limite)</span>
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

/**
 * Zones de recherche : une ligne par pays (+ ville facultative). L'état vit dans le navigateur
 * et part au serveur sérialisé dans un champ caché : un <form> HTML ne sait pas envoyer
 * une liste d'objets autrement.
 */
function AreasField({ initial }: { initial: SearchArea[] }) {
  const [areas, setAreas] = useState<SearchArea[]>(initial.length ? initial : [{ country: 'fr', city: '' }]);
  const update = (i: number, patch: Partial<SearchArea>) => setAreas(a => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <fieldset className="rounded-md border p-4">
      <legend className="px-1 text-sm font-medium">Zones de recherche</legend>
      <p className="mb-3 text-xs text-gray-500">
        Un pays par ligne. La ville affine la recherche Adzuna ; vide = tout le pays. Pour les pages carrières,
        tout le pays est gardé. Le Luxembourg n&apos;a pas de base Adzuna : il est couvert par les pages carrières.
      </p>
      <input type="hidden" name="areas" value={JSON.stringify(areas)} />
      <div className="space-y-2">
        {areas.map((area, i) => (
          <div key={i} className="flex gap-2">
            <select
              value={area.country}
              onChange={e => update(i, { country: e.target.value as CountryCode })}
              className="rounded-md border px-2 py-2 text-sm"
            >
              {COUNTRY_CODES.map(code => (
                <option key={code} value={code}>{COUNTRIES[code].label}</option>
              ))}
            </select>
            <input
              value={area.city}
              onChange={e => update(i, { city: e.target.value })}
              placeholder="Ville (facultatif)"
              className="flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={areas.length === 1}
              onClick={() => setAreas(a => a.filter((_, j) => j !== i))}
              className="px-2 text-sm text-gray-500 hover:text-red-600 disabled:opacity-30"
              aria-label="Retirer cette zone"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {areas.length < 6 && (
        <button type="button" onClick={() => setAreas(a => [...a, { country: 'lu', city: '' }])} className="mt-2 text-sm text-blue-700 hover:underline">
          + Ajouter un pays
        </button>
      )}
    </fieldset>
  );
}

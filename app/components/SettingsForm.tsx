'use client';

import { useActionState } from 'react';
import { updateSettings } from '../admin-actions';
import type { Settings } from '@/db/settings';
import { ResultMessage } from './ResultMessage';

const input = 'mt-1 w-28 rounded-md border px-3 py-2 text-sm';

export function SettingsForm({ initial, userCount }: { initial: Settings; userCount: number }) {
  const [result, formAction, pending] = useActionState(updateSettings, null);

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="signupOpen" defaultChecked={initial.signupOpen} className="h-4 w-4" />
        Inscriptions ouvertes
        <span className="font-normal text-gray-500">(fermées : seuls les comptes existants peuvent se connecter)</span>
      </label>
      <label className="block text-sm font-medium">
        Nombre maximum de comptes <span className="font-normal text-gray-500">(actuellement {userCount}, toi compris)</span>
        <input name="maxUsers" type="number" min={1} max={100} defaultValue={initial.maxUsers} className={`${input} block`} />
      </label>
      <label className="block text-sm font-medium">
        Offres notées au maximum par recherche{' '}
        <span className="font-normal text-gray-500">(au-delà : reportées au lendemain ; borne la durée et le coût Claude)</span>
        <input name="maxScoredPerRun" type="number" min={10} max={500} defaultValue={initial.maxScoredPerRun} className={`${input} block`} />
      </label>
      <label className="block text-sm font-medium">
        Nouvelles offres au maximum par recherche, comptes sans clé Claude{' '}
        <span className="font-normal text-gray-500">(sans notation pour trier, on garde un fil lisible)</span>
        <input name="maxUnscoredPerRun" type="number" min={10} max={500} defaultValue={initial.maxUnscoredPerRun} className={`${input} block`} />
      </label>
      <button disabled={pending} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
      <ResultMessage result={result} />
    </form>
  );
}

'use client';

import { useActionState, useRef, useEffect } from 'react';
import { addApplication } from '../../applications-actions';
import { COMPANY_TYPES, CONTRACTS, STAGES, STAGE_KEYS } from '@/lib/applications';
import { ResultMessage } from '../ResultMessage';

const input = 'rounded-md border px-2.5 py-1.5 text-sm';

/** Candidature faite hors de l'agent (recruteur LinkedIn, cooptation, salon…). */
export function AddApplicationForm() {
  const [result, action, pending] = useActionState(addApplication, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (result?.ok) form.current?.reset(); }, [result]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form ref={form} action={action} className="flex flex-wrap items-end gap-2">
      <input name="company" required placeholder="Entreprise" className={`${input} w-44`} />
      <select name="companyType" defaultValue="" className={input} aria-label="Type d'entreprise">
        <option value="">Type d&apos;entreprise</option>
        {COMPANY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input name="title" placeholder="Poste" className={`${input} w-48`} />
      <input name="url" type="url" placeholder="Lien de l'annonce (facultatif)" className={`${input} w-56`} />
      <select name="contract" defaultValue="CDI" className={input} aria-label="Type de contrat">
        {CONTRACTS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select name="stage" defaultValue="applied" className={input} aria-label="Étape">
        {STAGE_KEYS.map(s => <option key={s} value={s}>{STAGES[s].label}</option>)}
      </select>
      <input name="lastContact" type="date" defaultValue={today} className={input} aria-label="Dernier contact" />
      <input name="notes" placeholder="Notes (facultatif)" className={`${input} w-48`} />
      <button disabled={pending} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {pending ? 'Ajout…' : 'Ajouter'}
      </button>
      <ResultMessage result={result} />
    </form>
  );
}

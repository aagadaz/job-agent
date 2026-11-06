'use client';

import { useTransition } from 'react';
import { editApplication, removeApplication } from '../../applications-actions';
import { COMPANY_TYPES, CONTRACTS, STAGES, STAGE_KEYS, type Stage } from '@/lib/applications';
import { EditDate, EditSelect, EditText } from './Editable';

export interface ApplicationView {
  id: string; company: string; companyType: string; title: string; url: string; contract: string;
  stage: Stage; lastContact: string | null; notes: string; fromAgent: boolean;
  followUp: boolean; contacts: { name: string; role: string }[];
}

export function ApplicationRow({ a, index, contactsHref }: { a: ApplicationView; index: number; contactsHref?: string }) {
  const [deleting, startDelete] = useTransition();
  const save = (field: string) => (value: string) => editApplication(a.id, field, field === 'lastContact' ? (value || null) : value);

  return (
    <tr className={`border-t align-top ${a.followUp ? 'bg-amber-50/60' : ''} ${deleting ? 'opacity-40' : ''}`}>
      <td className="px-2 py-2 text-xs text-gray-400">{index}</td>
      <td className="min-w-40 px-1 py-1">
        <EditText value={a.company} save={save('company')} className="font-medium" />
        {a.contacts.length > 0 && (
          <a href={contactsHref} className="ml-1.5 inline-block rounded bg-blue-50 px-1.5 text-xs text-blue-800" title={a.contacts.map(c => `${c.name}${c.role ? ` (${c.role})` : ''}`).join(', ')}>
            {a.contacts.length} contact{a.contacts.length > 1 ? 's' : ''}
          </a>
        )}
      </td>
      <td className="px-1 py-1.5">
        <EditSelect value={a.companyType} save={save('companyType')} options={[{ value: '', label: '—' }, ...COMPANY_TYPES.map(t => ({ value: t, label: t }))]} />
      </td>
      <td className="min-w-48 px-1 py-1">
        <div className="flex items-center gap-1">
          <EditText value={a.title} save={save('title')} placeholder="Poste" />
          {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-gray-400 hover:text-gray-700" title="Ouvrir l'annonce">↗</a>}
        </div>
        {!a.url && <EditText value="" save={save('url')} placeholder="Coller le lien de l'annonce…" className="text-xs text-gray-500" />}
      </td>
      <td className="px-1 py-1.5">
        <EditSelect value={a.contract} save={save('contract')} options={CONTRACTS.map(c => ({ value: c, label: c }))} />
      </td>
      <td className="px-1 py-1.5">
        <EditSelect value={a.stage} save={save('stage')} tone={v => STAGES[v as Stage].tone} options={STAGE_KEYS.map(s => ({ value: s, label: STAGES[s].label }))} />
        {a.followUp && <div className="mt-1 text-xs font-medium text-amber-700">À relancer</div>}
      </td>
      <td className="px-1 py-1"><EditDate value={a.lastContact} save={save('lastContact')} /></td>
      <td className="min-w-48 px-1 py-1"><EditText value={a.notes} save={save('notes')} placeholder="Notes…" multiline /></td>
      <td className="px-2 py-2 text-right">
        <button
          onClick={() => startDelete(() => removeApplication(a.id))}
          className="text-xs text-gray-400 hover:text-red-600"
          title={a.fromAgent ? "Retirer du suivi (l'offre reste dans ton fil)" : 'Supprimer'}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

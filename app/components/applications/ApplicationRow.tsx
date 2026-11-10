'use client';

import { useEffect, useState, useTransition } from 'react';
import { editApplication, removeApplications } from '../../applications-actions';
import { CONTRACTS, STAGES, STAGE_KEYS, type Stage } from '@/lib/applications';
import { EditDate, EditSelect, EditText } from './Editable';

export interface ApplicationView {
  id: string; company: string; companyType: string; title: string; url: string; contract: string;
  stage: Stage; lastContact: string | null; notes: string;
  offerId: string | null; // candidature venue du fil : lien vers la fiche de l'offre (et sa lettre)
  hasLetter: boolean;
  followUp: boolean; contacts: { name: string; role: string }[];
}

interface RowProps { a: ApplicationView; index: number; contactsHref?: string; selected: boolean; onToggle: () => void; categories: string[] }

export function ApplicationRow({ a, index, contactsHref, selected, onToggle, categories }: RowProps) {
  const [deleting, startDelete] = useTransition();
  // Suppression en deux temps (sans boîte de dialogue du navigateur) : 1er clic = « Confirmer ? »,
  // qui disparaît tout seul après 4 s si on ne confirme pas.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);
  const save = (field: string) => (value: string) => editApplication(a.id, field, field === 'lastContact' ? (value || null) : value);

  return (
    <tr data-row-id={a.id} className={`cursor-default border-t align-top ${selected ? 'bg-blue-50/70' : a.followUp ? 'bg-amber-50/60' : ''} ${deleting ? 'opacity-40' : ''}`}>
      {/* touch-none : sur écran tactile, glisser depuis la case sélectionne au lieu de faire défiler */}
      <td className="cursor-pointer touch-none select-none py-2 pl-3 pr-1">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Sélectionner ${a.company}`} className="size-4 accent-gray-900" />
      </td>
      <td className="cursor-pointer touch-none select-none px-2 py-2 text-xs text-gray-400">{index}</td>
      <td className="min-w-40 px-1 py-1">
        <EditText value={a.company} save={save('company')} className="font-medium" />
        {a.contacts.length > 0 && (
          <a href={contactsHref} className="ml-1.5 inline-block rounded bg-blue-50 px-1.5 text-xs text-blue-800" title={a.contacts.map(c => `${c.name}${c.role ? ` (${c.role})` : ''}`).join(', ')}>
            {a.contacts.length} contact{a.contacts.length > 1 ? 's' : ''}
          </a>
        )}
      </td>
      <td className="px-1 py-1.5">
        <EditSelect value={a.companyType} save={save('companyType')} options={[{ value: '', label: '— (auto)' }, ...(categories.includes(a.companyType) || !a.companyType ? categories : [...categories, a.companyType]).map(t => ({ value: t, label: t }))]} />
      </td>
      <td className="min-w-48 px-1 py-1">
        <div className="flex items-center gap-1">
          <EditText value={a.title} save={save('title')} placeholder="Poste" />
          {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-gray-400 hover:text-gray-700" title="Ouvrir l'annonce">↗</a>}
        </div>
        {a.offerId && (
          <a href={`/offers/${a.offerId}`} className="text-xs text-blue-700 hover:underline" title="Fiche de l'offre : analyse, description et lettre de motivation">
            {a.hasLetter ? 'Lettre rédigée · fiche de l’offre' : 'Fiche de l’offre'}
          </a>
        )}
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
      {/* Colonne collée à droite : le bouton reste visible même quand le tableau défile horizontalement */}
      <td className={`sticky right-0 whitespace-nowrap border-l px-2 py-1.5 text-right ${selected ? 'bg-blue-50' : 'bg-white'}`}>
        {confirming ? (
          <span className="inline-flex items-center gap-1">
            <button
              onClick={() => { setConfirming(false); startDelete(async () => { await removeApplications([a.id]); }); }}
              className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
            >
              Supprimer
            </button>
            <button onClick={() => setConfirming(false)} className="px-1 text-xs text-gray-500 hover:text-gray-900">Annuler</button>
          </span>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={deleting}
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
            title={a.offerId ? 'Supprimer la ligne (l’offre redevient « À traiter » dans ton fil)' : 'Supprimer la ligne'}
            aria-label={`Supprimer la candidature ${a.company}`}
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
            </svg>
          </button>
        )}
      </td>
    </tr>
  );
}

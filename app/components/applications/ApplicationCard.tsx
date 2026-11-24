'use client';

import { useEffect, useState, useTransition } from 'react';
import { editApplication, removeApplications } from '../../applications-actions';
import { CONTRACTS, STAGES, STAGE_KEYS, type Stage } from '@/lib/applications';
import { EditDate, EditSelect, EditText } from './Editable';
import { AnalyzeButton } from './AnalyzeButton';
import type { ApplicationView } from './ApplicationRow';

/**
 * Une candidature sous forme de carte : la version téléphone d'une ligne du tableau. Mêmes
 * champs modifiables sur place, mêmes actions (sélection, suppression en deux temps).
 */
export function ApplicationCard({ a, contactsHref, selected, onToggle, categories }: {
  a: ApplicationView; contactsHref?: string; selected: boolean; onToggle: () => void; categories: string[];
}) {
  const [deleting, startDelete] = useTransition();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);
  const save = (field: string) => (value: string) => editApplication(a.id, field, field === 'lastContact' ? (value || null) : value);
  const typeOptions = [{ value: '', label: '— (auto)' }, ...(categories.includes(a.companyType) || !a.companyType ? categories : [...categories, a.companyType]).map(t => ({ value: t, label: t }))];

  return (
    <li className={`space-y-2 p-3 ${selected ? 'bg-blue-50/70' : a.followUp ? 'bg-amber-50/60' : ''} ${deleting ? 'opacity-40' : ''}`}>
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Sélectionner ${a.company}`} className="mt-2 size-5 shrink-0 accent-gray-900" />
        <div className="min-w-0 flex-1">
          <EditText value={a.company} save={save('company')} className="font-semibold" />
          <div className="flex items-center gap-1">
            <EditText value={a.title} save={save('title')} placeholder="Poste" className="text-gray-700" multiline />
            {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" className="shrink-0 p-1.5 text-gray-400" aria-label="Ouvrir l'annonce">↗</a>}
          </div>
          {!a.url && <EditText value="" save={save('url')} placeholder="Coller le lien de l'annonce…" className="text-xs text-gray-500" />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-7">
        <EditSelect value={a.stage} save={save('stage')} tone={v => STAGES[v as Stage].tone} options={STAGE_KEYS.map(s => ({ value: s, label: STAGES[s].label }))} />
        <EditSelect value={a.contract} save={save('contract')} options={CONTRACTS.map(c => ({ value: c, label: c }))} />
        <EditSelect value={a.companyType} save={save('companyType')} options={typeOptions} />
        {a.followUp && <span className="text-xs font-medium text-amber-700">À relancer</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-gray-500">
        <label className="flex items-center gap-1">
          Dernier contact
          <EditDate value={a.lastContact} save={save('lastContact')} />
        </label>
        {a.contacts.length > 0 && (
          <a href={contactsHref} className="rounded bg-blue-50 px-2 py-1 text-blue-800">
            {a.contacts.length} contact{a.contacts.length > 1 ? 's' : ''}
          </a>
        )}
        {a.offerId ? (
          <a href={`/offers/${a.offerId}`} className="py-1 text-blue-700">
            {a.hasLetter ? 'Lettre rédigée · fiche de l’offre' : 'Fiche de l’offre'}
          </a>
        ) : (
          <AnalyzeButton applicationId={a.id} compact />
        )}
      </div>

      <div className="pl-7">
        <EditText value={a.notes} save={save('notes')} placeholder="Notes…" multiline />
      </div>

      <div className="flex justify-end">
        {confirming ? (
          <span className="inline-flex items-center gap-2">
            <button
              onClick={() => { setConfirming(false); startDelete(async () => { await removeApplications([a.id]); }); }}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white"
            >
              Supprimer
            </button>
            <button onClick={() => setConfirming(false)} className="px-2 py-1.5 text-xs text-gray-500">Annuler</button>
          </span>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={deleting}
            className="px-2 py-1.5 text-xs text-gray-500"
            title={a.offerId ? 'L’offre redevient « À traiter » dans ton fil' : undefined}
          >
            Supprimer
          </button>
        )}
      </div>
    </li>
  );
}

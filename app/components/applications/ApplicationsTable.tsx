'use client';

import { useEffect, useState, useTransition } from 'react';
import { changeStages, removeApplications } from '../../applications-actions';
import { STAGES, STAGE_KEYS, type Stage } from '@/lib/applications';
import { ApplicationRow, type ApplicationView } from './ApplicationRow';
import { useDragSelect } from './useDragSelect';

// Tableau du suivi avec sélection multiple. La sélection est un état CLIENT (un Set d'id) :
// elle n'a pas besoin du serveur tant qu'on n'agit pas. Seule la suppression part au serveur,
// en UN appel pour toutes les lignes cochées.

export function ApplicationsTable({ rows, emptyMessage, categories }: { rows: (ApplicationView & { contactsHref: string })[]; emptyMessage: string; categories: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');

  // Après un filtre ou une suppression, on oublie les id qui ne sont plus affichés
  useEffect(() => {
    const visible = new Set(rows.map(r => r.id));
    setSelected(prev => new Set([...prev].filter(id => visible.has(id))));
  }, [rows]);

  // Cliquer-glisser sur les lignes, Maj + clic pour une plage, Espace au clavier
  const { onPointerDown, onCheckboxChange } = useDragSelect(rows.map(r => r.id), selected, setSelected);
  const allChecked = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map(r => r.id)));
  const n = selected.size;

  const [stage, setStage] = useState<Stage | ''>('');
  const [touchContact, setTouchContact] = useState(true);
  const applyStage = () => start(async () => {
    if (!stage) return;
    const res = await changeStages([...selected], stage, touchContact);
    setMessage(res.message);
    if (res.ok) { setSelected(new Set()); setStage(''); }
  });

  const removeSelected = () => start(async () => {
    const res = await removeApplications([...selected]);
    setMessage(res.message);
    setSelected(new Set());
    setConfirming(false);
  });

  return (
    <div className="rounded-xl border bg-white">
      {/* Barre d'actions hors du conteneur qui défile horizontalement : « sticky » ne colle qu'au
          plus proche ancêtre qui défile, elle reste ainsi visible sous l'en-tête de la page. */}
      {(n > 0 || message) && (
        <div className="sticky top-[49px] z-20 flex flex-wrap items-center gap-3 rounded-t-xl border-b bg-gray-50 px-3 py-2 text-sm shadow-sm">
          {n > 0 ? (
            <>
              <b>{n} sélectionnée{n > 1 ? 's' : ''}</b>
              {confirming ? (
                <>
                  <span className="text-red-700">Supprimer définitivement {n} ligne{n > 1 ? 's' : ''} ?</span>
                  <button onClick={removeSelected} disabled={pending} className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    {pending ? 'Suppression…' : 'Oui, supprimer'}
                  </button>
                  <button onClick={() => setConfirming(false)} className="text-xs text-gray-500 hover:text-gray-900">Annuler</button>
                </>
              ) : (
                <>
                  {/* Changement d'étape groupé */}
                  <select
                    value={stage}
                    onChange={e => setStage(e.target.value as Stage | '')}
                    aria-label="Nouvelle étape"
                    className="rounded-md border px-2 py-1 text-xs"
                  >
                    <option value="">Changer l&apos;étape…</option>
                    {STAGE_KEYS.map(s => <option key={s} value={s}>{STAGES[s].label}</option>)}
                  </select>
                  <label className="inline-flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" checked={touchContact} onChange={e => setTouchContact(e.target.checked)} className="accent-gray-900" />
                    Last contact = aujourd&apos;hui
                  </label>
                  <button onClick={applyStage} disabled={!stage || pending} className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                    {pending ? 'Mise à jour…' : 'Appliquer'}
                  </button>
                  <span className="text-gray-300" aria-hidden>|</span>
                  <button onClick={() => { setConfirming(true); setMessage(''); }} className="rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50">
                    Supprimer la sélection
                  </button>
                  <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-900">Tout désélectionner</button>
                </>
              )}
            </>
          ) : (
            <span className="text-green-700">{message}</span>
          )}
        </div>
      )}
      <p className="px-3 pt-2 text-xs text-gray-400">
        Astuce : clique et glisse sur les lignes pour en sélectionner plusieurs · Maj + clic pour une plage
      </p>
      <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="py-2 pl-3 pr-1">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Tout sélectionner" className="size-4 accent-gray-900" disabled={rows.length === 0} />
            </th>
            <th className="px-2 py-2">#</th><th className="px-2">Entreprise</th><th className="px-2">Type d&apos;entreprise</th>
            <th className="px-2">Poste (lien)</th><th className="px-2">Type</th><th className="px-2">Réponses</th>
            <th className="px-2">Last contact</th><th className="px-2">Notes</th><th className="sticky right-0 border-l bg-gray-50 px-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody onPointerDown={onPointerDown}>
          {rows.map((a, i) => (
            <ApplicationRow key={a.id} a={a} index={i + 1} contactsHref={a.contactsHref} selected={selected.has(a.id)} onToggle={() => onCheckboxChange(a.id)} categories={categories} />
          ))}
        </tbody>
      </table>
      </div>
      {rows.length === 0 && <p className="p-6 text-sm text-gray-500">{emptyMessage}</p>}
    </div>
  );
}

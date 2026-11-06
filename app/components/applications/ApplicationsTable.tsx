'use client';

import { useEffect, useState, useTransition } from 'react';
import { removeApplications } from '../../applications-actions';
import { ApplicationRow, type ApplicationView } from './ApplicationRow';

// Tableau du suivi avec sélection multiple. La sélection est un état CLIENT (un Set d'id) :
// elle n'a pas besoin du serveur tant qu'on n'agit pas. Seule la suppression part au serveur,
// en UN appel pour toutes les lignes cochées.

export function ApplicationsTable({ rows, emptyMessage }: { rows: (ApplicationView & { contactsHref: string })[]; emptyMessage: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');

  // Après un filtre ou une suppression, on oublie les id qui ne sont plus affichés
  useEffect(() => {
    const visible = new Set(rows.map(r => r.id));
    setSelected(prev => new Set([...prev].filter(id => visible.has(id))));
  }, [rows]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allChecked = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map(r => r.id)));
  const n = selected.size;

  const removeSelected = () => start(async () => {
    const res = await removeApplications([...selected]);
    setMessage(res.message);
    setSelected(new Set());
    setConfirming(false);
  });

  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      {(n > 0 || message) && (
        <div className="flex flex-wrap items-center gap-3 border-b bg-gray-50 px-3 py-2 text-sm">
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
        <tbody>
          {rows.map((a, i) => (
            <ApplicationRow key={a.id} a={a} index={i + 1} contactsHref={a.contactsHref} selected={selected.has(a.id)} onToggle={() => toggle(a.id)} />
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-6 text-sm text-gray-500">{emptyMessage}</p>}
    </div>
  );
}

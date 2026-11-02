'use client';

import { useMemo, useState, useTransition } from 'react';
import { addFromCatalog } from '../actions';
import { countryLabel } from '@/lib/countries';

export interface CatalogItem {
  id: string;
  name: string;
  ats: string;
  sector: string;
  category: string;
  countries: string[];
  jobCount: number;
}

const CATEGORIES = ['AI & tech', 'Consulting', 'Financial services', 'Industry'];

/** Catalogue partagé : filtrer, cocher, ajouter en une fois. */
export function CatalogPicker({ items }: { items: CatalogItem[] }) {
  const [category, setCategory] = useState('');
  const [country, setCountry] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const countries = useMemo(() => [...new Set(items.flatMap(i => i.countries))].sort(), [items]);
  const visible = items.filter(i =>
    (!category || i.category === category)
    && (!country || i.countries.includes(country))
    && (!query || i.name.toLowerCase().includes(query.toLowerCase()) || i.sector.toLowerCase().includes(query.toLowerCase())),
  );

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allVisibleSelected = visible.length > 0 && visible.every(i => selected.has(i.id));
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev);
    for (const i of visible) { if (allVisibleSelected) next.delete(i.id); else next.add(i.id); }
    return next;
  });

  const add = () => startTransition(async () => {
    const res = await addFromCatalog([...selected]);
    setMessage({ ok: res.ok, text: res.message });
    if (res.ok) setSelected(new Set());
  });

  if (items.length === 0) {
    return <p className="text-sm text-gray-500">Tu suis déjà toutes les entreprises du catalogue (ou il n&apos;a pas encore été construit).</p>;
  }

  const select = 'rounded-md border px-2 py-1.5 text-sm';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={category} onChange={e => setCategory(e.target.value)} className={select} aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={country} onChange={e => setCountry(e.target.value)} className={select} aria-label="Pays">
          <option value="">Tous pays</option>
          {countries.map(c => <option key={c} value={c}>{countryLabel(c)}</option>)}
        </select>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher (nom, secteur)…" className={`${select} min-w-48 flex-1`} />
      </div>

      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
          Tout sélectionner ({visible.length})
        </label>
        <button
          onClick={add}
          disabled={pending || selected.size === 0}
          className="rounded-md bg-gray-900 px-3 py-1.5 font-medium text-white disabled:opacity-40"
        >
          {pending ? 'Ajout…' : `Ajouter ${selected.size} entreprise${selected.size > 1 ? 's' : ''}`}
        </button>
      </div>

      <ul className="max-h-96 divide-y overflow-y-auto rounded-md border">
        {visible.map(i => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50">
              <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
              <span className="flex-1">
                <span className="font-medium">{i.name}</span>
                <span className="ml-2 text-gray-500">{i.sector} · {i.countries.map(countryLabel).join(', ')}</span>
              </span>
              <span className="text-xs text-gray-500">{i.jobCount} offres · {i.ats}</span>
            </label>
          </li>
        ))}
      </ul>
      {message && <p className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-700'}`}>{message.text}</p>}
    </div>
  );
}

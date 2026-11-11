'use client';

import { useState, useTransition } from 'react';
import { createCoverLetter, saveCoverLetter } from '../actions';

/**
 * Lettre de motivation : générée par Claude, puis ÉDITABLE (c'est un brouillon, pas un
 * produit fini). Le texte est enregistré, on le retrouve en revenant sur l'offre.
 */
export interface LetterCv { id: string; name: string; active: boolean }

export function CoverLetterPanel({ offerId, initial, canGenerate, cvs = [] }: { offerId: string; initial: string | null; canGenerate: boolean; cvs?: LetterCv[] }) {
  // CV utilisé pour la lettre : celui qui note les offres par défaut, modifiable (FR / EN…)
  const [cvId, setCvId] = useState(cvs.find(c => c.active)?.id ?? cvs[0]?.id ?? '');
  const [text, setText] = useState(initial ?? '');
  const [saved, setSaved] = useState(initial ?? '');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const generate = () =>
    startTransition(async () => {
      setMessage(null);
      const res = await createCoverLetter(offerId, note, cvId || undefined);
      if (res.ok) { setText(res.letter); setSaved(res.letter); }
      setMessage({ ok: res.ok, text: res.message });
    });

  const save = () =>
    startTransition(async () => {
      const res = await saveCoverLetter(offerId, text);
      if (res.ok) setSaved(text);
      setMessage({ ok: res.ok, text: res.message });
    });

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setMessage({ ok: true, text: 'Lettre copiée.' });
  };

  if (!canGenerate && !initial) {
    return (
      <p className="text-sm text-gray-600">
        Ajoute ta clé Claude et ton CV dans <a href="/profile#cv" className="underline">Profil</a> pour générer une lettre adaptée à cette offre.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {text ? (
        <>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={14}
            className="w-full rounded-md border p-3 text-sm leading-relaxed"
          />
          <p className="text-xs text-gray-500">
            {words} mots · relis-la et ajuste-la : c&apos;est un brouillon, c&apos;est toi qui signes.
          </p>
        </>
      ) : (
        <p className="text-sm text-gray-600">
          Une lettre courte (180 à 260 mots), écrite à partir de ton CV et de cette offre, sans formules toutes faites.
        </p>
      )}
      {canGenerate && (
        <label className="block text-sm">
          <span className="font-medium">Pourquoi cette offre t&apos;intéresse ?</span>{' '}
          <span className="text-gray-500">(facultatif, une phrase suffit, avec tes mots : c&apos;est ce qui rend la lettre humaine)</span>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={600}
            rows={2}
            placeholder="Ex. : j'utilise leur appli tous les jours ; je veux travailler sur des modèles en production plutôt qu'en R&D…"
            className="mt-1 w-full rounded-md border p-2 text-sm"
          />
        </label>
      )}
      {canGenerate && cvs.length > 1 && (
        <label className="block text-sm">
          <span className="font-medium">CV utilisé</span>
          <select value={cvId} onChange={e => setCvId(e.target.value)} className="mt-1 block w-full rounded-md border px-2 py-2 text-sm sm:w-auto">
            {cvs.map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? ' (notation)' : ''}</option>)}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {canGenerate && (
          <button onClick={generate} disabled={pending} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {pending ? 'Rédaction…' : text ? 'Régénérer' : 'Générer une lettre'}
          </button>
        )}
        {text && (
          <>
            <button onClick={copy} className="rounded-md border px-3 py-1.5 text-sm">Copier</button>
            <button onClick={save} disabled={pending || text === saved} className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50">
              Enregistrer mes modifications
            </button>
          </>
        )}
      </div>
      {message && <p className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-700'}`}>{message.text}</p>}
    </div>
  );
}

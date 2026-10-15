'use client';

import { useState, useTransition } from 'react';
import { createCoverLetter, saveCoverLetter } from '../actions';

/**
 * Lettre de motivation : générée par Claude, puis ÉDITABLE (c'est un brouillon, pas un
 * produit fini). Le texte est enregistré, on le retrouve en revenant sur l'offre.
 */
export function CoverLetterPanel({ offerId, initial, canGenerate }: { offerId: string; initial: string | null; canGenerate: boolean }) {
  const [text, setText] = useState(initial ?? '');
  const [saved, setSaved] = useState(initial ?? '');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const generate = () =>
    startTransition(async () => {
      setMessage(null);
      const res = await createCoverLetter(offerId);
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
        Ajoute ta clé Claude et ton CV dans <a href="/profile" className="underline">Profil</a> pour générer une lettre adaptée à cette offre.
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
          Une lettre courte (150 à 230 mots), écrite à partir de ton CV et de cette offre, sans formules toutes faites.
        </p>
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

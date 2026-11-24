'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { analyzeApplication, type AnalyzeResult } from '../../applications-actions';

/**
 * Candidature saisie à la main : lit l'annonce (lien, ou texte collé si le site ne se laisse
 * pas lire), la note avec le CV, puis ouvre sa fiche (compatibilité + lettre de motivation).
 */
export function AnalyzeButton({ applicationId, compact = false }: { applicationId: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);

  const run = (pasted = '') => start(async () => {
    const res = await analyzeApplication(applicationId, pasted);
    setResult(res);
    if (res.needText) setOpen(true);
    // Tout s'est bien passé : on ouvre la fiche. Sinon (note impossible…), on laisse lire
    // l'explication, avec un lien vers la fiche.
    if (res.ok && res.offerId && res.message === 'Annonce analysée.') router.push(`/offers/${res.offerId}`);
  });

  return (
    <div className={`${compact ? '' : 'mt-1'} ${open ? 'w-full' : ''}`}>
      {!open && (
        <button
          onClick={() => run()}
          disabled={pending}
          className="py-1 text-xs font-medium text-blue-700 hover:underline disabled:opacity-50"
          title="Lit l'annonce, calcule la compatibilité avec ton CV et permet de générer une lettre"
        >
          {pending ? 'Lecture de l’annonce…' : 'Analyser avec mon CV'}
        </button>
      )}
      {result?.message && !result.ok && <p className="mt-1 max-w-xs text-xs text-amber-700">{result.message}</p>}
      {result?.ok && result.offerId && result.message !== 'Annonce analysée.' && (
        <p className="mt-1 max-w-xs text-xs text-gray-600">
          {result.message}{' '}
          <a href={`/offers/${result.offerId}`} className="font-medium text-blue-700 hover:underline">Ouvrir la fiche →</a>
        </p>
      )}
      {open && (
        <div className="mt-1 space-y-1">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={4}
            maxLength={15000}
            placeholder="Colle ici le texte de l'annonce (missions, profil recherché…)"
            className="w-full min-w-56 rounded-md border px-2 py-1.5 text-sm"
          />
          <div className="flex gap-3">
            <button onClick={() => run(text)} disabled={pending || !text.trim()} className="rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
              {pending ? 'Analyse…' : 'Analyser'}
            </button>
            <button onClick={() => { setOpen(false); setResult(null); }} className="py-1 text-xs text-gray-500">Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

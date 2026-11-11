'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { activateCvAction, addCv, deleteCvAction, renameCvAction, type CvActionResult } from '../cv-actions';
import { ResultMessage } from './ResultMessage';

export interface CvView {
  id: string; name: string; fileName: string | null; fileSize: number | null; text: string; createdAt: string; active: boolean;
}

const input = 'w-full rounded-md border px-3 py-2 text-sm';
const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`);

/** Bibliothèque de CV : liste, ajout (PDF ou texte), choix du CV actif, téléchargement, suppression. */
export function CvLibrary({ cvs, max }: { cvs: CvView[]; max: number }) {
  return (
    <div className="space-y-4">
      {cvs.length === 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Aucun CV pour l&apos;instant. Ajoute-en un : il sert à noter les offres et à rédiger les lettres.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {cvs.map(cv => <CvItem key={cv.id} cv={cv} />)}
        </ul>
      )}
      {cvs.length < max ? <AddCvForm first={cvs.length === 0} /> : (
        <p className="text-sm text-gray-500">{max} CV maximum : supprime-en un pour en ajouter un autre.</p>
      )}
    </div>
  );
}

function CvItem({ cv }: { cv: CvView }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<CvActionResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(cv.name);
  useEffect(() => setName(cv.name), [cv.name]);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);
  const run = (action: () => Promise<CvActionResult>) => start(async () => setResult(await action()));
  const added = new Date(cv.createdAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

  return (
    <li className={`space-y-2 p-3 ${pending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => { if (name.trim() && name !== cv.name) run(() => renameCvAction(cv.id, name)); }}
          aria-label="Nom du CV"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 font-medium hover:border-gray-200 focus:border-gray-300 focus:outline-none"
        />
        {cv.active && (
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800" title="C'est ce CV qui note les offres et rédige les lettres par défaut">
            Utilisé pour la notation
          </span>
        )}
      </div>
      <p className="px-1.5 text-xs text-gray-500">
        {cv.fileName ? <>{cv.fileName} · {sizeLabel(cv.fileSize ?? 0)}</> : 'Texte collé'} · ajouté le {added} · {cv.text.length.toLocaleString('fr-FR')} caractères lus
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1.5 text-sm">
        {!cv.active && (
          <button onClick={() => run(() => activateCvAction(cv.id))} disabled={pending} className="py-1 font-medium text-blue-700 hover:underline">
            Utiliser pour la notation
          </button>
        )}
        {cv.fileName && (
          <a href={`/api/cvs/${cv.id}`} target="_blank" rel="noopener noreferrer" className="py-1 text-blue-700 hover:underline">
            Ouvrir le PDF
          </a>
        )}
        {confirming ? (
          <span className="inline-flex items-center gap-2">
            <button onClick={() => { setConfirming(false); run(() => deleteCvAction(cv.id)); }} className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white">
              Supprimer
            </button>
            <button onClick={() => setConfirming(false)} className="py-1 text-xs text-gray-500">Annuler</button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} className="py-1 text-gray-500 hover:text-red-600">Supprimer</button>
        )}
      </div>
      <details className="px-1.5 text-sm text-gray-600">
        <summary className="cursor-pointer py-1">Voir le texte lu par Claude</summary>
        <p className="mt-1 text-xs text-gray-500">
          S&apos;il est vide, coupé ou dans le désordre (PDF en colonnes), ajoute plutôt ce CV en collant son texte.
        </p>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-gray-50 p-3 text-xs text-gray-800">{cv.text}</pre>
      </details>
      {result?.message && <ResultMessage result={result} />}
    </li>
  );
}

function AddCvForm({ first }: { first: boolean }) {
  const [result, action, pending] = useActionState(addCv, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (result?.ok) form.current?.reset(); }, [result]);

  return (
    <details open={first} className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">+ Ajouter un CV</summary>
      <form ref={form} action={action} className="mt-3 space-y-3">
        <label className="block text-sm font-medium">
          Nom
          <input name="name" required maxLength={80} placeholder="Ex. CV data FR, CV anglais…" className={`mt-1 ${input}`} />
        </label>
        <label className="block text-sm">
          Fichier PDF <span className="text-gray-500">(4 Mo maximum, conservé pour être retéléchargé)</span>
          <input name="file" type="file" accept="application/pdf" className="mt-1 block w-full min-w-0 text-sm" />
        </label>
        <label className="block text-sm">
          …ou coller le texte du CV
          <textarea name="text" rows={4} className={`mt-1 ${input}`} />
        </label>
        <button disabled={pending} className="w-full rounded-md bg-gray-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto sm:py-2">
          {pending ? 'Lecture du CV…' : 'Ajouter le CV'}
        </button>
        {first && <p className="text-xs text-gray-500">Ton premier CV sera utilisé pour noter les offres ; tu pourras en changer à tout moment.</p>}
        <ResultMessage result={result} />
      </form>
    </details>
  );
}

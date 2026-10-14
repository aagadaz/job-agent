'use client';

import { useTransition } from 'react';
import { reportClosed } from '../actions';

/**
 * « Offre fermée » : à cliquer quand l'annonce n'est plus disponible chez l'employeur.
 * Le signalement est partagé (l'offre disparaît aussi du fil des autres utilisateurs),
 * et réversible : sur une offre signalée, le bouton propose « Toujours ouverte ».
 */
export function ClosedButton({ offerId, closed }: { offerId: string; closed: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => reportClosed(offerId, !closed))}
      title={closed ? 'Annuler le signalement' : "L'annonce n'est plus disponible chez l'employeur"}
      className={`text-xs hover:underline disabled:opacity-50 ${closed ? 'text-blue-700' : 'text-gray-500 hover:text-amber-700'}`}
    >
      {pending ? '…' : closed ? 'Toujours ouverte ?' : 'Offre fermée'}
    </button>
  );
}

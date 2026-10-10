'use client';

import { useState, useTransition } from 'react';
import { deleteUser } from '../admin-actions';

/** Suppression en deux temps : un clic arme le bouton, un second clic (dans les 5 s) confirme. */
export function DeleteUserButton({ userId, email }: { userId: string; email: string }) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!armed) {
    return (
      <button
        onClick={() => { setArmed(true); setTimeout(() => setArmed(false), 5000); }}
        className="text-xs text-gray-500 hover:text-red-600"
      >
        Supprimer
      </button>
    );
  }
  return (
    <span className="flex flex-col items-end">
      <button
        disabled={pending}
        onClick={() => startTransition(async () => {
          const r = await deleteUser(userId);
          if (!r.ok) setError(r.message);
        })}
        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Suppression…' : `Confirmer : supprimer ${email} et ses données`}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

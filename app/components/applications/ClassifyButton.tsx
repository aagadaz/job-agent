'use client';

import { useState, useTransition } from 'react';
import { autoClassify } from '../../applications-actions';

/** « Classer avec Claude » : remplit les types d'entreprise manquants. */
export function ClassifyButton({ untyped }: { untyped: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="mb-2 text-xs">
      {untyped > 0 && (
        <button
          onClick={() => start(async () => setResult(await autoClassify()))}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
          </svg>
          {pending ? 'Classement…' : `Classer avec Claude (${untyped} sans type)`}
        </button>
      )}
      {result && <p className={`mt-1 ${result.ok ? 'text-green-700' : 'text-red-600'}`}>{result.message}</p>}
    </div>
  );
}

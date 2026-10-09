'use client';

import { useState, useTransition } from 'react';
import { changeStatus } from '../actions';
import { STATUS_LABELS } from '@/lib/status';

export function StatusSelect({ offerId, status }: { offerId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        defaultValue={status}
        disabled={pending}
        onChange={e => {
          const next = e.target.value;
          startTransition(async () => {
            setFeedback(await changeStatus(offerId, next));
          });
        }}
        className="rounded-md border px-2 py-1 text-sm disabled:opacity-50"
      >
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      {feedback?.message && (
        <span className={`max-w-56 text-right text-xs ${feedback.ok ? 'text-green-700' : 'text-red-600'}`}>
          {feedback.message}
        </span>
      )}
    </div>
  );
}

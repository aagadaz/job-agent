'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { summarizeRun, type RunSnapshot, type RunSummary } from '@/lib/run-summary';

const POLL_MS = 15_000;

const TONES: Record<RunSummary['tone'], string> = {
  success: 'border-green-200 bg-green-50 text-green-800',
  info: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-800',
};

/**
 * Pendant une recherche : rafraîchit la page toutes les 15 s (router.refresh() relance le
 * rendu serveur, qui relit la base et réconcilie avec GitHub). Quand la recherche passe de
 * « en cours » à terminée SOUS LES YEUX de l'utilisateur, affiche une notification du résultat.
 */
export function RunWatcher({ run }: { run: RunSnapshot | null }) {
  const router = useRouter();
  const previous = useRef<RunSnapshot | null>(run);
  const [notice, setNotice] = useState<RunSummary | null>(null);
  const running = run?.status === 'running';

  // 1) Sondage (polling) uniquement tant que la recherche tourne, et onglet visible
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer); // nettoyage : plus de sondage dès que la recherche est finie
  }, [running, router]);

  // 2) Détection de la transition « en cours » → « terminée » pour CETTE exécution
  useEffect(() => {
    const before = previous.current;
    if (before?.status === 'running' && run && run.id === before.id && run.status !== 'running') {
      setNotice(summarizeRun(run));
    }
    previous.current = run;
  }, [run]);

  if (!notice) return null;
  return (
    <div role="status" className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${TONES[notice.tone]}`}>
      <span>
        <b>Recherche terminée.</b> {notice.text}
      </span>
      <button onClick={() => setNotice(null)} aria-label="Fermer" className="opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

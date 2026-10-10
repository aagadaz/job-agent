import Link from 'next/link';
import { RunSearchButton } from '../../components/RunSearchButton';
import { RunWatcher } from '../../components/RunWatcher';
import { summarizeRun, type RunSnapshot } from '@/lib/run-summary';
import { ScoreBadge } from '../../components/ScoreBadge';
import { DismissButton } from '../../components/DismissButton';
import { StatusSelect } from '../../components/StatusSelect';
import { STATUSES, listOffers, type ApplicationStatus } from '@/db/dashboard';
import { getReconciledLastRun } from '@/lib/run-status';
import { requireUserId } from '@/lib/session';

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ rejected?: string; status?: string; dismissed?: string }>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const showRejected = params.rejected === '1';
  const dismissed = params.dismissed === '1'; // vue « Corbeille »
  // Valeur venant de l'URL : on ne la garde que si elle fait partie des statuts connus
  const status = STATUSES.find(s => s === params.status) as ApplicationStatus | undefined;

  const [rows, run] = await Promise.all([listOffers(userId, { showRejected: showRejected || dismissed, status, dismissed }), getReconciledLastRun(userId)]);

  // Ce qui part vers le composant client : des données simples et sérialisables (pas de Date)
  const snapshot: RunSnapshot | null = run
    ? { id: run.id, status: run.status, error: run.error, stats: run.stats }
    : null;

  return (
    <div className="space-y-4">
      <RunWatcher run={snapshot} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{dismissed ? 'Corbeille' : 'Offres'} ({rows.length})</h1>
          {run && (
            <p className="text-sm text-gray-500">
              Dernière recherche : {run.startedAt.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} ·{' '}
              {summarizeRun(snapshot!).text}
            </p>
          )}
          <div className="mt-2">
            <RunSearchButton running={run?.status === 'running'} />
          </div>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/offers" className="rounded-md border bg-white px-3 py-1">Toutes</Link>
          <Link href="/offers?status=a_traiter" className="rounded-md border bg-white px-3 py-1">À traiter</Link>
          <Link href="/offers?status=postule" className="rounded-md border bg-white px-3 py-1">Postulées</Link>
          <Link href={showRejected ? '/offers' : '/offers?rejected=1'} className="rounded-md border bg-white px-3 py-1">
            {showRejected ? 'Masquer les écartées' : 'Voir les écartées'}
          </Link>
          <Link href={dismissed ? '/offers' : '/offers?dismissed=1'} className="rounded-md border bg-white px-3 py-1">
            {dismissed ? '← Retour au fil' : 'Corbeille'}
          </Link>
        </nav>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border bg-white p-6 text-sm text-gray-500">
          {dismissed
            ? 'La corbeille est vide.'
            : "Aucune offre pour l'instant. Vérifie ton profil (CV et clé Claude) : la recherche tourne chaque matin à 7h17."}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map(o => (
            <li key={o.offerId} className={`rounded-xl border bg-white p-4 ${o.rejected ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start gap-3">
                <ScoreBadge score={o.score} />
                <div className="min-w-0 flex-1">
                  {/* Le titre ouvre la fiche complète ; ↗ ouvre directement l'annonce d'origine */}
                  <Link href={`/offers/${o.offerId}`} className="font-medium hover:underline">
                    {o.title}
                  </Link>
                  <a href={o.url} target="_blank" rel="noopener noreferrer" title="Annonce originale" className="ml-2 text-sm text-gray-400 hover:text-gray-700">
                    ↗
                  </a>
                  <p className="text-sm text-gray-600">
                    {o.company} · {o.location || 'Lieu non précisé'} · {o.source}
                    {o.datePosted && ` · ${o.datePosted}`}
                  </p>
                  {o.justification && <p className="mt-2 text-sm">{o.justification}</p>}
                  <div className="mt-2 flex flex-wrap gap-1 text-xs">
                    {o.strengths.map(s => (
                      <span key={`+${s}`} className="rounded bg-green-50 px-2 py-0.5 text-green-800">+ {s}</span>
                    ))}
                    {o.missingSkills.map(s => (
                      <span key={`-${s}`} className="rounded bg-red-50 px-2 py-0.5 text-red-700">− {s}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusSelect offerId={o.offerId} status={o.status} />
                  <DismissButton offerId={o.offerId} dismissed={dismissed} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from 'next/link';
import { RunSearchButton } from '../../components/RunSearchButton';
import { StatusSelect } from '../../components/StatusSelect';
import { STATUSES, listOffers, type ApplicationStatus } from '@/db/dashboard';
import { getReconciledLastRun } from '@/lib/run-status';
import { requireUserId } from '@/lib/session';

function scoreColor(score: number | null): string {
  if (score === null) return 'bg-gray-100 text-gray-600';
  if (score >= 70) return 'bg-green-100 text-green-800';
  if (score >= 50) return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ rejected?: string; status?: string }>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const showRejected = params.rejected === '1';
  // Valeur venant de l'URL : on ne la garde que si elle fait partie des statuts connus
  const status = STATUSES.find(s => s === params.status) as ApplicationStatus | undefined;

  const [rows, run] = await Promise.all([listOffers(userId, { showRejected, status }), getReconciledLastRun(userId)]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Offres ({rows.length})</h1>
          {run && (
            <p className="text-sm text-gray-500">
              Dernière recherche : {run.startedAt.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} ·{' '}
              {run.status === 'error' ? `échec : ${run.error}` : run.status === 'running' ? 'en cours' : 'réussie'}
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
        </nav>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border bg-white p-6 text-sm text-gray-500">
          Aucune offre pour l&apos;instant. Vérifie ton profil (CV et clé Claude) : la recherche tourne chaque matin à 7h17.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map(o => (
            <li key={o.offerId} className={`rounded-xl border bg-white p-4 ${o.rejected ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start gap-3">
                <span className={`rounded-md px-2 py-1 text-sm font-semibold ${scoreColor(o.score)}`}>
                  {o.score ?? '—'}
                </span>
                <div className="min-w-0 flex-1">
                  <a href={o.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                    {o.title}
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
                <StatusSelect offerId={o.offerId} status={o.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

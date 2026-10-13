import Link from 'next/link';
import { RunSearchButton } from '../../components/RunSearchButton';
import { RunWatcher } from '../../components/RunWatcher';
import { summarizeRun, type RunSnapshot } from '@/lib/run-summary';
import { describeRunError } from '@/lib/run-errors';
import { ScoreBadge } from '../../components/ScoreBadge';
import { DismissButton } from '../../components/DismissButton';
import { StatusSelect } from '../../components/StatusSelect';
import { STATUSES, countOffersByCountry, getUserWithProfile, listOffers, type ApplicationStatus } from '@/db/dashboard';
import { searchMode } from '@/lib/search-mode';
import { COUNTRY_CODES, countryLabel } from '@/lib/countries';
import { getReconciledLastRun } from '@/lib/run-status';
import { isAdmin, requireUserId } from '@/lib/session';

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ rejected?: string; status?: string; dismissed?: string; country?: string }>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const showRejected = params.rejected === '1';
  const dismissed = params.dismissed === '1'; // vue « Corbeille »
  // Valeur venant de l'URL : on ne la garde que si elle fait partie des statuts connus
  const status = STATUSES.find(s => s === params.status) as ApplicationStatus | undefined;

  // Pays venant de l'URL : accepté seulement s'il est connu (ou 'none' = pays non déterminé)
  const country = params.country === 'none' || COUNTRY_CODES.includes(params.country as never) ? params.country : undefined;

  const filters = { showRejected: showRejected || dismissed, dismissed };
  const [rows, byCountry, run, account] = await Promise.all([
    listOffers(userId, { ...filters, status, country }),
    countOffersByCountry(userId, filters),
    getReconciledLastRun(userId),
    getUserWithProfile(userId),
  ]);
  const mode = searchMode({
    hasKey: !!account?.user.anthropicKeyEncrypted,
    hasCv: !!account?.profile?.cvText,
    keywords: account?.profile?.keywords ?? [],
  });
  const total = byCountry.reduce((sum, c) => sum + c.n, 0);

  /** Lien qui change UN paramètre en gardant les autres (filtres combinables). */
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/offers?${qs}` : '/offers';
  };

  // Ce qui part vers le composant client : des données simples et sérialisables (pas de Date)
  // Erreur : message clair pour l'utilisateur ; le détail technique ne quitte le serveur
  // que pour un administrateur (le navigateur reçoit tout ce qu'on met dans les props).
  const admin = await isAdmin();
  const snapshot: RunSnapshot | null = run
    ? {
        id: run.id,
        status: run.status,
        error: run.status === 'error' ? describeRunError(run.error) : null,
        details: admin && run.status === 'error' ? run.error : null,
        stats: run.stats,
      }
    : null;

  return (
    <div className="space-y-4">
      <RunWatcher run={snapshot} />
      {mode !== 'scored' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {mode === 'unscored' ? (
            <>
              <b>Mode sans clé :</b> tu reçois les offres qui correspondent à tes mots-clés, triées par date, sans note.{' '}
              <Link href="/profile" className="underline">Ajoute une clé Claude et ton CV</Link> pour que chaque offre soit notée selon ton profil.
            </>
          ) : (
            <>
              Pour démarrer, <Link href="/profile" className="underline">indique tes mots-clés dans Profil</Link> (et,
              si tu veux des offres notées, ton CV et une clé Claude).
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{dismissed ? 'Corbeille' : 'Offres'} ({rows.length})</h1>
          {run && (
            <p className="text-sm text-gray-500">
              Dernière recherche : {run.startedAt.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} ·{' '}
              {summarizeRun(snapshot!).text}
            </p>
          )}
          {snapshot?.details && (
            <details className="text-xs text-gray-400">
              <summary className="cursor-pointer">Détails techniques (admin)</summary>
              <pre className="mt-1 max-w-xl whitespace-pre-wrap break-all">{snapshot.details}</pre>
            </details>
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

      {/* Onglets par pays : affichés dès que les offres couvrent plus d'un pays */}
      {byCountry.length > 1 && (
        <nav className="flex flex-wrap gap-2 border-b pb-3 text-sm">
          <Link href={href({ country: undefined })} className={`rounded-full px-3 py-1 ${!country ? 'bg-gray-900 text-white' : 'border bg-white'}`}>
            Tous les pays ({total})
          </Link>
          {byCountry.map(c => (
            <Link
              key={c.country}
              href={href({ country: c.country })}
              className={`rounded-full px-3 py-1 ${country === c.country ? 'bg-gray-900 text-white' : 'border bg-white'}`}
            >
              {countryLabel(c.country)} ({c.n})
            </Link>
          ))}
        </nav>
      )}

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
                    {o.company} · {o.location || 'Lieu non précisé'} · <b className="font-medium">{countryLabel(o.country)}</b> · {o.source}
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

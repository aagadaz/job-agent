import Link from 'next/link';
import { RunSearchButton } from '../../components/RunSearchButton';
import { RunWatcher } from '../../components/RunWatcher';
import { summarizeRun, type RunSnapshot } from '@/lib/run-summary';
import { describeRunError } from '@/lib/run-errors';
import { ScoreBadge } from '../../components/ScoreBadge';
import { DismissButton } from '../../components/DismissButton';
import { StatusSelect } from '../../components/StatusSelect';
import {
  SORTS, SORT_LABELS, STATUSES, countOffersByCountry, getUserWithProfile, listOffers,
  type ApplicationStatus, type OfferSort,
} from '@/db/dashboard';
import { searchMode } from '@/lib/search-mode';
import { COUNTRY_CODES, countryLabel } from '@/lib/countries';
import { REDIRECTING_SOURCES, offerSearchLinks } from '@/lib/search-links';
import { getReconciledLastRun } from '@/lib/run-status';
import { isAdmin, requireUserId } from '@/lib/session';

const REJECT_LABELS = {
  score: 'note sous ton seuil',
  experience: 'trop d\u2019expérience exigée',
  expired: 'probablement fermée (retirée par l\u2019entreprise ou annonce trop ancienne)',
} as const;

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ rejected?: string; status?: string; dismissed?: string; country?: string; sort?: string }>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const showRejected = params.rejected === '1';
  const dismissed = params.dismissed === '1'; // vue « Corbeille »
  // Valeur venant de l'URL : on ne la garde que si elle fait partie des statuts connus
  const status = STATUSES.find(s => s === params.status) as ApplicationStatus | undefined;

  // Pays venant de l'URL : accepté seulement s'il est connu (ou 'none' = pays non déterminé)
  const country = params.country === 'none' || COUNTRY_CODES.includes(params.country as never) ? params.country : undefined;

  // Tri : 'recent' par défaut (les nouvelles offres en haut) ; toute valeur inconnue est ignorée
  const sort: OfferSort = SORTS.find(s => s === params.sort) ?? 'recent';

  const filters = { showRejected: showRejected || dismissed, dismissed };
  const [rows, byCountry, run, account] = await Promise.all([
    listOffers(userId, { ...filters, status, country, sort }),
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
  // « Nouvelle » = arrivée dans le fil depuis moins de 24 h (donc par la recherche du jour)
  const now = Date.now();
  const isNew = (addedAt: Date) => now - addedAt.getTime() < 24 * 3600_000;
  const newCount = dismissed ? 0 : rows.filter(o => isNew(o.addedAt)).length;
  // Sans note (mode sans clé), trier par note n'a pas de sens : on ne propose pas ce tri
  const sortOptions = SORTS.filter(s => s !== 'score' || mode === 'scored');

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
          <h1 className="text-lg font-semibold">
            {dismissed ? 'Corbeille' : 'Offres'} ({rows.length})
            {newCount > 0 && (
              <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 align-middle text-xs font-medium text-white">
                {newCount} nouvelle{newCount > 1 ? 's' : ''}
              </span>
            )}
          </h1>
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
          {/* Ces liens changent de vue mais CONSERVENT le tri choisi */}
          <Link href={href({ status: undefined, rejected: undefined, dismissed: undefined, country: undefined })} className="rounded-md border bg-white px-3 py-1">Toutes</Link>
          <Link href={href({ status: 'a_traiter', dismissed: undefined })} className="rounded-md border bg-white px-3 py-1">À traiter</Link>
          <Link href={href({ status: 'postule', dismissed: undefined })} className="rounded-md border bg-white px-3 py-1">Postulées</Link>
          <Link href={href({ rejected: showRejected ? undefined : '1' })} className="rounded-md border bg-white px-3 py-1">
            {showRejected ? 'Masquer les écartées' : 'Voir les écartées'}
          </Link>
          <Link href={href({ dismissed: dismissed ? undefined : '1', status: undefined })} className="rounded-md border bg-white px-3 py-1">
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

      {/* Tri : de simples liens (?sort=…), la page est recalculée côté serveur */}
      {rows.length > 1 && (
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Trier les offres">
          <span className="text-gray-500">Trier par :</span>
          {sortOptions.map(s => (
            <Link
              key={s}
              href={href({ sort: s === 'recent' ? undefined : s })}
              aria-current={sort === s ? 'true' : undefined}
              className={`rounded-full px-3 py-1 ${sort === s ? 'bg-gray-900 text-white' : 'border bg-white'}`}
            >
              {SORT_LABELS[s]}
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
                  {!dismissed && isNew(o.addedAt) && (
                    <span className="mr-2 rounded bg-blue-100 px-1.5 py-0.5 align-middle text-xs font-semibold text-blue-800">Nouveau</span>
                  )}
                  <Link href={`/offers/${o.offerId}`} className="font-medium hover:underline">
                    {o.title}
                  </Link>
                  <a href={o.url} target="_blank" rel="noopener noreferrer" title="Annonce originale" className="ml-2 text-sm text-gray-400 hover:text-gray-700">
                    ↗
                  </a>
                  {REDIRECTING_SOURCES.has(o.source) && (
                    <a
                      href={offerSearchLinks(o.title, o.company, o.location)[0].url}
                      target="_blank" rel="noopener noreferrer"
                      title="Chercher l'offre sur Google (si le lien Adzuna ne s'ouvre pas)"
                      className="ml-2 text-xs text-gray-400 hover:text-gray-700 hover:underline"
                    >
                      chercher ailleurs
                    </a>
                  )}
                  <p className="text-sm text-gray-600">
                    {o.company} · {o.location || 'Lieu non précisé'} · <b className="font-medium">{countryLabel(o.country)}</b> · {o.source}
                    {o.datePosted && ` · publiée le ${o.datePosted}`}
                    {` · ajoutée le ${o.addedAt.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`}
                  </p>
                  {o.rejected && o.rejectReason && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      Écartée : {REJECT_LABELS[o.rejectReason]}
                      {o.rejectReason === 'experience' && o.requiredYears !== null && ` (${o.requiredYears} ans demandés)`}
                    </p>
                  )}
                  {!o.rejected && o.requiredYears !== null && (
                    <p className="mt-1 text-xs text-gray-500">Expérience demandée : {o.requiredYears} an{o.requiredYears > 1 ? 's' : ''} minimum</p>
                  )}
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

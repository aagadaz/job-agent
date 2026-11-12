import Link from 'next/link';
import { RunSearchButton } from '../../components/RunSearchButton';
import { RunWatcher } from '../../components/RunWatcher';
import { summarizeRun, type RunSnapshot } from '@/lib/run-summary';
import { describeRunError } from '@/lib/run-errors';
import { ScoreBadge } from '../../components/ScoreBadge';
import { DismissButton } from '../../components/DismissButton';
import { ClosedButton } from '../../components/ClosedButton';
import { StatusSelect } from '../../components/StatusSelect';
import { PAGE_SIZE, countFavorites, countOffers, feedFacets, getUserWithProfile, listOffers } from '@/db/dashboard';
import { FavoriteButton } from '../../components/FavoriteButton';
import { DEFAULT_SORT, DIR_LABELS, SORT_KEYS, SORT_LABELS, cycleSort, isDefaultSort, serializeSort } from '@/lib/offer-sort';
import { FEED_STATUS_LABELS } from '@/lib/status';
import { classifyContract } from '@/lib/contracts';
import { BULK_FORM_ID, BulkOffersBar } from '../../components/BulkOffersBar';
import { AutoSubmitForm } from '../../components/AutoSubmitForm';
import { SINCE_OPTIONS, SCORE_OPTIONS, activeCount, filtersHref, parseFilters, type ParsedFilters, type RawParams } from './filters';
import { searchMode } from '@/lib/search-mode';
import { countryLabel } from '@/lib/countries';
import { REDIRECTING_SOURCES, offerSearchLinks } from '@/lib/search-links';
import { getReconciledLastRun } from '@/lib/run-status';
import { isAdmin, requireUserId } from '@/lib/session';

const REJECT_LABELS = {
  score: 'note sous ton seuil',
  experience: 'trop d\u2019expérience exigée',
  source: 'source désactivée dans ton profil',
  contract: 'type de contrat hors de tes critères (Profil)',
  expired: 'probablement fermée (retirée par l\u2019entreprise ou annonce trop ancienne)',
} as const;

const SOURCE_LABELS: Record<string, string> = {
  adzuna: 'Adzuna', francetravail: 'France Travail', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby',
  workable: 'Workable', recruitee: 'Recruitee', smartrecruiters: 'SmartRecruiters', workday: 'Workday',
  personio: 'Personio', teamtailor: 'Teamtailor', website: 'Site carrières', manual: 'Ajout manuel',
};
const SINCE_LABELS: Record<number, string> = { 1: 'Dernières 24 h', 7: '7 derniers jours', 30: '30 derniers jours' };

export default async function OffersPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const userId = await requireUserId();
  // Tous les filtres viennent de l'URL, validés par liste blanche (cf. filters.ts)
  const f: ParsedFilters = parseFilters(await searchParams);
  const { showRejected, sort } = f;
  const dismissed = !!f.dismissed; // vue « Corbeille »
  const favoritesView = !!f.favorites; // vue « Favoris »
  const nActive = activeCount(f);

  const [rows, total, nFavorites, facets, run, account] = await Promise.all([
    listOffers(userId, f),
    countOffers(userId, f),
    countFavorites(userId),
    feedFacets(userId, f),
    getReconciledLastRun(userId),
    getUserWithProfile(userId),
  ]);
  const mode = searchMode({
    hasKey: !!account?.user.anthropicKeyEncrypted,
    hasCv: !!account?.profile?.cvText,
    keywords: account?.profile?.keywords ?? [],
  });
  // « Nouvelle » = arrivée dans le fil depuis moins de 24 h (donc par la recherche du jour)
  const now = Date.now();
  const isNew = (addedAt: Date) => now - addedAt.getTime() < 24 * 3600_000;
  const newCount = dismissed ? 0 : rows.filter(o => isNew(o.addedAt)).length;
  // Sans note (mode sans clé), trier par note n'a pas de sens : on ne propose pas ce tri
  const sortOptions = SORT_KEYS.filter(s => s !== 'score' || mode === 'scored');
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = (f.page - 1) * PAGE_SIZE + 1;

  /** Lien qui change UNE famille de filtres en gardant toutes les autres. */
  const href = (patch: Partial<ParsedFilters>) => filtersHref(f, patch);
  const without = <T,>(arr: T[] | undefined, v: T) => (arr ?? []).filter(x => x !== v);

  // Pastilles des filtres actifs, chacune avec son lien de retrait
  const chips: { label: string; href: string }[] = [
    ...(f.q ? [{ label: `« ${f.q} »`, href: href({ q: undefined }) }] : []),
    ...(f.statuses ?? []).map(v => ({ label: FEED_STATUS_LABELS[v], href: href({ statuses: without(f.statuses, v) }) })),
    ...(f.countries ?? []).map(v => ({ label: countryLabel(v), href: href({ countries: without(f.countries, v) }) })),
    ...(f.sources ?? []).map(v => ({ label: SOURCE_LABELS[v] ?? v, href: href({ sources: without(f.sources, v) }) })),
    ...(f.minScore !== undefined ? [{ label: `Note ≥ ${f.minScore}`, href: href({ minScore: undefined }) }] : []),
    ...(f.sinceDays ? [{ label: SINCE_LABELS[f.sinceDays], href: href({ sinceDays: undefined }) }] : []),
    ...(showRejected && !dismissed ? [{ label: 'Écartées incluses', href: href({ showRejected: false }) }] : []),
  ];
  const clearAll = filtersHref({ showRejected: false, dismissed, favorites: favoritesView, sort });

  /** Valeurs proposées pour une famille : celles présentes dans le fil + celles déjà cochées. */
  const options = (facet: { value: string; n: number }[], selected: string[] = []) => [
    ...facet,
    ...selected.filter(v => !facet.some(x => x.value === v)).map(value => ({ value, n: 0 })),
  ];

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
              <Link href="/profile#cv" className="underline">Ajoute une clé Claude et ton CV</Link> pour que chaque offre soit notée selon ton profil.
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
            {dismissed ? 'Corbeille' : favoritesView ? 'Favoris' : 'Offres'} ({total})
            {newCount > 0 && (
              <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 align-middle text-xs font-medium text-white">
                {newCount} nouvelle{newCount > 1 ? 's' : ''}
              </span>
            )}
          </h1>
          {!dismissed && !favoritesView && !f.statuses?.length && (
            <p className="text-sm text-gray-500">
              Offres auxquelles tu n&apos;as pas encore postulé. Les autres sont dans{' '}
              <Link href="/applications" className="underline">Candidatures</Link>.
            </p>
          )}
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
          {!dismissed && (
            <Link
              href={filtersHref({ ...f, favorites: !favoritesView })}
              aria-current={favoritesView ? 'true' : undefined}
              className={`inline-flex items-center gap-1 rounded-md border px-3 py-1 ${favoritesView ? 'bg-gray-900 text-white' : 'bg-white'}`}
            >
              {favoritesView ? '← Tout le fil' : <><span className="text-amber-500" aria-hidden>★</span> Favoris ({nFavorites})</>}
            </Link>
          )}
          {!favoritesView && (
            <Link href={filtersHref({ ...f, dismissed: !dismissed, showRejected: false })} className="rounded-md border bg-white px-3 py-1">
              {dismissed ? '← Retour au fil' : 'Corbeille'}
            </Link>
          )}
        </nav>
      </div>

      {/* Filtres CUMULABLES : un formulaire GET, chaque changement recharge la page avec l'URL à jour.
          Entre familles = ET (statut ET pays ET source…) ; dans une famille = OU (France OU Luxembourg). */}
      <details open={nActive > 0} className="rounded-xl border bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Filtres{nActive > 0 && ` (${nActive})`}
        </summary>
        <AutoSubmitForm className="grid gap-4 border-t px-4 py-4 text-sm md:grid-cols-2 lg:grid-cols-4">
          {!isDefaultSort(sort) && <input type="hidden" name="sort" value={serializeSort(sort)} />}
          {dismissed && <input type="hidden" name="dismissed" value="1" />}
          {favoritesView && <input type="hidden" name="fav" value="1" />}

          <div className="md:col-span-2 lg:col-span-4 flex gap-2">
            <input
              type="search" name="q" defaultValue={f.q ?? ''} maxLength={80}
              placeholder="Rechercher un intitulé ou une entreprise…"
              className="flex-1 rounded-md border px-3 py-1.5"
            />
            <button className="rounded-md bg-gray-900 px-3 py-1.5 font-medium text-white">Rechercher</button>
          </div>

          <fieldset>
            <legend className="mb-1 font-medium">Statut</legend>
            {!dismissed && !favoritesView && (
              <p className="mb-1 text-xs text-gray-500">Aucune case cochée : « À traiter » et « À postuler ».</p>
            )}
            {options(facets.status, f.statuses).map(o => (
              <label key={o.value} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" name="status" value={o.value} defaultChecked={f.statuses?.includes(o.value as never)} />
                {FEED_STATUS_LABELS[o.value as keyof typeof FEED_STATUS_LABELS] ?? o.value} <span className="text-gray-400">({o.n})</span>
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend className="mb-1 font-medium">Pays</legend>
            {options(facets.country, f.countries).map(o => (
              <label key={o.value} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" name="country" value={o.value} defaultChecked={f.countries?.includes(o.value)} />
                {countryLabel(o.value)} <span className="text-gray-400">({o.n})</span>
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend className="mb-1 font-medium">Source</legend>
            {options(facets.source, f.sources).map(o => (
              <label key={o.value} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" name="source" value={o.value} defaultChecked={f.sources?.includes(o.value)} />
                {SOURCE_LABELS[o.value] ?? o.value} <span className="text-gray-400">({o.n})</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium">Autres</legend>
            {mode === 'scored' && (
              <label className="block">
                Note minimale{' '}
                <select name="min" defaultValue={f.minScore ?? ''} className="ml-1 rounded-md border px-2 py-1">
                  <option value="">Toutes</option>
                  {SCORE_OPTIONS.map(v => <option key={v} value={v}>{v} et plus</option>)}
                </select>
              </label>
            )}
            <label className="block">
              Ajoutées{' '}
              <select name="since" defaultValue={f.sinceDays ?? ''} className="ml-1 rounded-md border px-2 py-1">
                <option value="">Toute période</option>
                {SINCE_OPTIONS.map(v => <option key={v} value={v}>{SINCE_LABELS[v]}</option>)}
              </select>
            </label>
            {!dismissed && (
              <label className="flex items-center gap-2">
                <input type="checkbox" name="rejected" value="1" defaultChecked={showRejected} />
                Inclure les offres écartées
              </label>
            )}
          </fieldset>
        </AutoSubmitForm>
      </details>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {chips.map(c => (
            <Link key={c.label} href={c.href} className="rounded-full bg-gray-900 px-3 py-1 text-white hover:bg-gray-700" title="Retirer ce filtre">
              {c.label} ×
            </Link>
          ))}
          <Link href={clearAll} className="text-gray-500 underline">Tout effacer</Link>
        </div>
      )}

      {/* Tri multi-critères : chaque pastille est un lien (?sort=score.desc,posted.asc) ; un clic
          ajoute le critère en dernier, un 2e clic inverse son sens, un 3e le retire. */}
      {total > 1 && (
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Trier les offres">
          <span className="text-gray-500">Trier par :</span>
          {sortOptions.map(key => {
            const pos = sort.findIndex(s => s.key === key);
            const spec = pos >= 0 ? sort[pos] : null;
            const next = cycleSort(sort, key);
            const action = !spec ? 'ajouter ce critère' : next.some(s => s.key === key) ? 'inverser le sens' : 'retirer ce critère';
            return (
              <Link
                key={key}
                href={href({ sort: next })}
                aria-current={spec ? 'true' : undefined}
                title={`${spec ? `${SORT_LABELS[key]} : ${DIR_LABELS[key][spec.dir]}` : SORT_LABELS[key]} — cliquer pour ${action}`}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${spec ? 'bg-gray-900 text-white' : 'border bg-white'}`}
              >
                {spec && sort.length > 1 && (
                  <span className="grid size-4 place-items-center rounded-full bg-white/25 text-[10px] font-semibold" aria-label={`priorité ${pos + 1}`}>{pos + 1}</span>
                )}
                {SORT_LABELS[key]}
                {spec && <span aria-hidden>{spec.dir === 'desc' ? '↓' : '↑'}</span>}
              </Link>
            );
          })}
          {!isDefaultSort(sort) && (
            <Link href={href({ sort: DEFAULT_SORT })} className="text-xs text-gray-500 underline hover:text-gray-900">Réinitialiser le tri</Link>
          )}
          <span className="w-full text-xs text-gray-400 sm:w-auto">
            {sort.map(s => `${SORT_LABELS[s.key]} (${DIR_LABELS[s.key][s.dir]})`).join(', puis ')}
          </span>
        </nav>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border bg-white p-6 text-sm text-gray-500">
          {nActive > 0 ? (
            <>Aucune offre ne correspond à ces filtres. <Link href={clearAll} className="underline">Tout effacer</Link></>
          ) : dismissed
            ? 'La corbeille est vide.'
            : favoritesView
            ? 'Aucun favori pour l’instant. Touche l’étoile ☆ d’une offre pour la retrouver ici.'
            : "Aucune offre pour l'instant. Vérifie ton profil (CV et clé Claude) : la recherche tourne chaque matin à 7h17."}
        </p>
      ) : (
        <>
        <BulkOffersBar dismissed={dismissed} favoritesView={favoritesView} />
        <ul className="space-y-3">
          {rows.map(o => (
            <li key={o.offerId} className={`rounded-xl border bg-white p-3 sm:p-4 ${o.rejected ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start gap-3">
                <input
                  type="checkbox" name="ids" value={o.offerId} form={BULK_FORM_ID}
                  aria-label={`Sélectionner ${o.title}`} className="mt-1.5 size-4 accent-gray-900"
                />
                <ScoreBadge score={o.score} />
                <div className="min-w-0 flex-1">
                  {/* Le titre ouvre la fiche complète ; ↗ ouvre directement l'annonce d'origine */}
                  {!dismissed && isNew(o.addedAt) && (
                    <span className="mr-2 rounded bg-blue-100 px-1.5 py-0.5 align-middle text-xs font-semibold text-blue-800">Nouveau</span>
                  )}
                  <Link href={`/offers/${o.offerId}`} className="font-medium hover:underline">
                    {o.title}
                  </Link>
                  {/^https?:/.test(o.url) && <a href={o.url} target="_blank" rel="noopener noreferrer" title="Annonce originale" aria-label="Annonce originale" className="ml-1 inline-block px-1 py-0.5 text-sm text-gray-400 hover:text-gray-700">
                    ↗
                  </a>}
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
                    {o.company} · {o.location || 'Lieu non précisé'} · <b className="font-medium">{countryLabel(o.country)}</b>
                    {(() => { const c = classifyContract(o.employmentType, o.title); return c ? <> · <b className="font-medium">{c}</b></> : null; })()}
                    {` · ${o.source}`}
                    {o.datePosted && ` · publiée le ${o.datePosted}`}
                    {` · ajoutée le ${o.addedAt.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`}
                  </p>
                  {o.rejected && o.rejectReason && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      Écartée : {o.rejectReason === 'expired' && o.closedAt ? 'signalée fermée par un utilisateur' : REJECT_LABELS[o.rejectReason]}
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
                {/* Étoile : à droite du titre (sur téléphone aussi, en haut de la carte) */}
                {!dismissed && <FavoriteButton offerId={o.offerId} favorite={o.favorite} />}
                {/* Téléphone : actions sur leur propre ligne, sous l'offre (w-full force le retour à la
                    ligne). Écran large : colonne à droite, comme avant. */}
                <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3 sm:w-auto sm:flex-col sm:items-end sm:border-0 sm:pt-0">
                  <StatusSelect offerId={o.offerId} status={o.status} />
                  <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
                    {!dismissed && <ClosedButton offerId={o.offerId} closed={o.closedAt !== null} />}
                    <DismissButton offerId={o.offerId} dismissed={dismissed} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {pages > 1 && (
          <nav className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages du fil">
            <span className="text-gray-500">
              Offres {firstShown} à {firstShown + rows.length - 1} sur {total}
            </span>
            <span className="flex items-center gap-2">
              {f.page > 1 && <Link href={href({ page: f.page - 1 })} className="rounded-md border bg-white px-3 py-1">← Précédentes</Link>}
              <span className="text-gray-500">Page {f.page} / {pages}</span>
              {f.page < pages && <Link href={href({ page: f.page + 1 })} className="rounded-md border bg-white px-3 py-1">Suivantes →</Link>}
            </span>
          </nav>
        )}
        </>
      )}
    </div>
  );
}

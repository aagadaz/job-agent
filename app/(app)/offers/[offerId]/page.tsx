import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ScoreBadge } from '../../../components/ScoreBadge';
import { DismissButton } from '../../../components/DismissButton';
import { ClosedButton } from '../../../components/ClosedButton';
import { StatusSelect } from '../../../components/StatusSelect';
import { getOfferDetail, getUserWithProfile } from '@/db/dashboard';
import { CoverLetterPanel } from '../../../components/CoverLetterPanel';
import { countryLabel } from '@/lib/countries';
import { REDIRECTING_SOURCES, offerSearchLinks } from '@/lib/search-links';
import { requireUserId } from '@/lib/session';

// La génération de lettre appelle Claude depuis la server action de cette page :
// on laisse jusqu'à 60 s à la fonction serverless (10 s par défaut sur certains plans).
export const maxDuration = 60;

const VERDICTS = { postuler: 'Postuler', a_etudier: 'À étudier', ignorer: 'Ignorer' } as const;

// Sources dont l'API ne fournit qu'un extrait de l'annonce
const EXCERPT_ONLY = new Set(['adzuna']);

export default async function OfferPage({ params }: { params: Promise<{ offerId: string }> }) {
  const userId = await requireUserId();
  const { offerId } = await params;

  // Segment d'URL = donnée utilisateur : on le valide avant de l'envoyer en SQL
  if (!z.string().uuid().safeParse(offerId).success) notFound();
  // Requête filtrée par userId : une offre d'un autre utilisateur donne la même 404 qu'une
  // offre inexistante (on ne révèle même pas qu'elle existe)
  const [offer, account] = await Promise.all([getOfferDetail(userId, offerId), getUserWithProfile(userId)]);
  if (!offer) notFound();
  const canGenerate = !!account?.user.anthropicKeyEncrypted && !!account?.profile?.cvText;

  const excerpt = EXCERPT_ONLY.has(offer.source);
  const meta = [offer.company, offer.location || 'Lieu non précisé', countryLabel(offer.country), offer.employmentType, offer.datePosted && `publiée le ${offer.datePosted}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="space-y-6">
      <Link href="/offers" className="inline-block py-1.5 text-sm text-gray-500 hover:underline">← Toutes les offres</Link>

      <header className="flex flex-wrap items-start gap-4 rounded-xl border bg-white p-4 sm:p-6">
        <ScoreBadge score={offer.score} large />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold sm:text-xl">{offer.title}</h1>
          <p className="text-sm text-gray-600">{meta}</p>
          {offer.salary && offer.salary !== 'Non précisé' && <p className="text-sm text-gray-600">Salaire : {offer.salary}</p>}
          <a
            href={offer.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white sm:py-1.5"
          >
            Voir l&apos;annonce originale ↗
          </a>
          {REDIRECTING_SOURCES.has(offer.source) && (
            <p className="mt-2 text-sm text-gray-500">
              Le lien {offer.source} ne s&apos;ouvre pas ? Chercher l&apos;offre sur{' '}
              {offerSearchLinks(offer.title, offer.company, offer.location).map((l, i) => (
                <span key={l.label}>
                  {i > 0 && ' · '}
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-800">{l.label} ↗</a>
                </span>
              ))}
            </p>
          )}
        </div>
        {/* Téléphone : actions sur leur propre ligne ; écran large : colonne à droite */}
        <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3 sm:w-auto sm:flex-col sm:items-end sm:border-0 sm:pt-0">
          <StatusSelect offerId={offer.offerId} status={offer.status} />
          <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
            <ClosedButton offerId={offer.offerId} closed={offer.closedAt !== null} />
            <DismissButton offerId={offer.offerId} dismissed={offer.dismissedAt !== null} redirectTo="/offers" />
          </div>
        </div>
      </header>

      {(offer.justification || offer.strengths.length > 0 || offer.missingSkills.length > 0) && (
        <section className="rounded-xl border bg-white p-4 sm:p-6">
          <h2 className="mb-2 font-semibold">
            Analyse de Claude{offer.verdict && ` · ${VERDICTS[offer.verdict]}`}
          </h2>
          {offer.justification && <p className="text-sm">{offer.justification}</p>}
          <div className="mt-3 flex flex-wrap gap-1 text-xs">
            {offer.strengths.map(s => <span key={`+${s}`} className="rounded bg-green-50 px-2 py-0.5 text-green-800">+ {s}</span>)}
            {offer.missingSkills.map(s => <span key={`-${s}`} className="rounded bg-red-50 px-2 py-0.5 text-red-700">− {s}</span>)}
          </div>
        </section>
      )}

      <section className="rounded-xl border bg-white p-4 sm:p-6">
        <h2 className="mb-2 font-semibold">Lettre de motivation</h2>
        <CoverLetterPanel offerId={offer.offerId} initial={offer.coverLetter} canGenerate={canGenerate} />
      </section>

      <section className="rounded-xl border bg-white p-4 sm:p-6">
        <h2 className="mb-2 font-semibold">Description</h2>
        {excerpt && (
          <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {offer.source} ne fournit qu&apos;un extrait de l&apos;annonce : le texte complet est sur l&apos;annonce originale.
          </p>
        )}
        {/* whitespace-pre-line : conserve les retours à la ligne du texte. Rendu comme TEXTE par
            React (échappé automatiquement) : un contenu externe ne peut pas injecter de HTML. */}
        <div className="whitespace-pre-line text-sm leading-relaxed text-gray-800">
          {offer.description || 'Aucune description fournie par la source.'}
        </div>
      </section>

      {offer.qualifications && (
        <section className="rounded-xl border bg-white p-4 sm:p-6">
          <h2 className="mb-2 font-semibold">Profil recherché</h2>
          <div className="whitespace-pre-line text-sm leading-relaxed text-gray-800">{offer.qualifications}</div>
        </section>
      )}
    </article>
  );
}

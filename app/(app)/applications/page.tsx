import Link from 'next/link';
import { importFromFeed, listApplications, listContacts } from '@/db/applications';
import { STAGES, STAGE_KEYS, companyKey, needsFollowUp, RELANCE_DAYS, type Stage } from '@/lib/applications';
import { requireUserId } from '@/lib/session';
import { ApplicationRow, type ApplicationView } from '../../components/applications/ApplicationRow';
import { AddApplicationForm } from '../../components/applications/AddApplicationForm';
import { AddContactForm, ContactRow, type ContactView } from '../../components/applications/ContactsPanel';

type Params = { tab?: string; stage?: string; q?: string; relance?: string; company?: string };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const userId = await requireUserId();
  const p = await searchParams;
  const tab = p.tab === 'contacts' ? 'contacts' : 'applications';

  // Les offres du fil déjà marquées « Postulé »… rejoignent le suivi (idempotent)
  await importFromFeed(userId);
  const [apps, contacts] = await Promise.all([listApplications(userId), listContacts(userId)]);

  // Rapprochement entreprise ↔ contacts, par nom normalisé
  const contactsBy = new Map<string, typeof contacts>();
  for (const c of contacts) contactsBy.set(companyKey(c.company), [...(contactsBy.get(companyKey(c.company)) ?? []), c]);
  const appsBy = new Map<string, number>();
  for (const a of apps) appsBy.set(companyKey(a.company), (appsBy.get(companyKey(a.company)) ?? 0) + 1);

  const views: ApplicationView[] = apps.map(a => ({
    id: a.id, company: a.company, companyType: a.companyType, title: a.title, url: a.url, contract: a.contract,
    stage: a.stage as Stage, lastContact: a.lastContact, notes: a.notes, fromAgent: a.offerId !== null,
    followUp: needsFollowUp(a.stage as Stage, a.lastContact),
    contacts: (contactsBy.get(companyKey(a.company)) ?? []).map(c => ({ name: c.name, role: c.role })),
  }));

  // Filtres (étape, recherche, à relancer) — valeurs d'URL validées par liste blanche
  const stage = STAGE_KEYS.find(s => s === p.stage);
  const q = (p.q ?? '').trim().toLowerCase().slice(0, 80);
  const relance = p.relance === '1';
  const shown = views.filter(v =>
    (!stage || v.stage === stage)
    && (!relance || v.followUp)
    && (!q || `${v.company} ${v.title} ${v.notes}`.toLowerCase().includes(q)),
  );

  // Statistiques
  const sent = views.filter(v => v.stage !== 'not_started').length;
  const answered = views.filter(v => ['in_conversation', 'unsuccessful', 'committed'].includes(v.stage)).length;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const thisWeek = apps.filter(a => a.stage !== 'not_started' && a.lastContact && new Date(a.lastContact).getTime() >= weekAgo).length;
  const toFollow = views.filter(v => v.followUp).length;
  const counts = Object.fromEntries(STAGE_KEYS.map(s => [s, views.filter(v => v.stage === s).length]));

  const href = (patch: Partial<Params>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...p, ...patch })) if (v) s.set(k, v);
    const qs = s.toString();
    return qs ? `/applications?${qs}` : '/applications';
  };
  const chip = (active: boolean) => `rounded-full px-3 py-1 text-sm ${active ? 'bg-gray-900 text-white' : 'border bg-white text-gray-600 hover:text-gray-900'}`;

  const contactViews: ContactView[] = contacts
    .filter(c => !p.company || companyKey(c.company) === companyKey(p.company))
    .map(c => ({ ...c, applications: appsBy.get(companyKey(c.company)) ?? 0 }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Candidatures</h1>
          <p className="text-sm text-gray-500">
            {sent} envoyée{sent > 1 ? 's' : ''} · {thisWeek} cette semaine · taux de réponse {sent ? Math.round((answered / sent) * 100) : 0} %
            {' · '}{counts.in_conversation} en discussion
          </p>
        </div>
        <nav className="flex gap-1 rounded-lg border bg-white p-1 text-sm">
          <Link href="/applications" className={`rounded-md px-3 py-1 ${tab === 'applications' ? 'bg-gray-100 font-medium' : 'text-gray-500'}`}>Suivi ({views.length})</Link>
          <Link href="/applications?tab=contacts" className={`rounded-md px-3 py-1 ${tab === 'contacts' ? 'bg-gray-100 font-medium' : 'text-gray-500'}`}>Contacts ({contacts.length})</Link>
        </nav>
      </div>

      {tab === 'applications' ? (
        <>
          {toFollow > 0 && !relance && (
            <Link href={href({ relance: '1', stage: undefined })} className="block rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              <b>{toFollow} candidature{toFollow > 1 ? 's' : ''} à relancer</b> : envoyée{toFollow > 1 ? 's' : ''} il y a plus de {RELANCE_DAYS} jours sans nouvelles. Voir →
            </Link>
          )}

          <section className="rounded-xl border bg-white p-4">
            <h2 className="mb-3 text-sm font-medium">Ajouter une candidature faite ailleurs</h2>
            <AddApplicationForm />
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <Link href={href({ stage: undefined, relance: undefined })} className={chip(!stage && !relance)}>Toutes ({views.length})</Link>
            {STAGE_KEYS.filter(s => counts[s] > 0 || s === stage).map(s => (
              <Link key={s} href={href({ stage: s, relance: undefined })} className={chip(stage === s)}>{STAGES[s].label} ({counts[s]})</Link>
            ))}
            {toFollow > 0 && <Link href={href({ relance: relance ? undefined : '1', stage: undefined })} className={chip(relance)}>À relancer ({toFollow})</Link>}
            <form action="/applications" className="ml-auto">
              {stage && <input type="hidden" name="stage" value={stage} />}
              <input type="search" name="q" defaultValue={p.q ?? ''} placeholder="Rechercher…" className="rounded-md border px-3 py-1.5 text-sm" />
            </form>
          </div>

          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-2">#</th><th className="px-2">Entreprise</th><th className="px-2">Type d&apos;entreprise</th>
                  <th className="px-2">Poste (lien)</th><th className="px-2">Type</th><th className="px-2">Réponses</th>
                  <th className="px-2">Last contact</th><th className="px-2">Notes</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((a, i) => (
                  <ApplicationRow key={a.id} a={a} index={i + 1} contactsHref={`/applications?tab=contacts&company=${encodeURIComponent(a.company)}`} />
                ))}
              </tbody>
            </table>
            {shown.length === 0 && (
              <p className="p-6 text-sm text-gray-500">
                {views.length === 0
                  ? 'Aucune candidature pour l’instant. Passe une offre en « Postulé » dans ton fil, ou ajoute une candidature faite ailleurs ci-dessus.'
                  : 'Aucune candidature ne correspond à ces filtres.'}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <section className="rounded-xl border bg-white p-4">
            <h2 className="mb-1 text-sm font-medium">Ajouter un contact</h2>
            <p className="mb-3 text-xs text-gray-500">
              Une personne que tu connais dans une entreprise (recruteur, alumni, ancien collègue). Elle apparaît ensuite sur tes
              candidatures chez cette entreprise. Ces informations ne sont visibles que par toi.
            </p>
            <AddContactForm defaultCompany={p.company ?? ''} />
          </section>
          {p.company && (
            <p className="text-sm text-gray-500">
              Contacts chez <b>{p.company}</b> · <Link href="/applications?tab=contacts" className="underline">voir tous les contacts</Link>
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-2 py-2">Entreprise</th><th className="px-2">Nom</th><th className="px-2">Rôle</th><th className="px-2">E-mail</th><th className="px-2">LinkedIn</th><th className="px-2">Notes</th><th /></tr>
              </thead>
              <tbody>{contactViews.map(c => <ContactRow key={c.id} c={c} />)}</tbody>
            </table>
            {contactViews.length === 0 && <p className="p-6 text-sm text-gray-500">Aucun contact pour l&apos;instant.</p>}
          </div>
        </>
      )}
    </div>
  );
}

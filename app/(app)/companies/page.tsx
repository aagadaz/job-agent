import { CompanyForm } from '../../components/CompanyForm';
import { ImportCompaniesForm } from '../../components/ImportCompaniesForm';
import { removeCompany } from '../../actions';
import { listCatalog, listCompanies } from '@/db/dashboard';
import { CatalogPicker } from '../../components/CatalogPicker';
import { requireUserId } from '@/lib/session';

// Durée max des fonctions de cette page, server actions comprises : l'import d'un fichier
// interroge des dizaines d'API et peut prendre jusqu'à une minute.
export const maxDuration = 60;

export default async function CompaniesPage() {
  const userId = await requireUserId();
  const [companies, catalog] = await Promise.all([listCompanies(userId), listCatalog(userId)]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-4 sm:p-6">
        <h1 className="mb-1 text-lg font-semibold">Entreprises suivies ({companies.length})</h1>
        <p className="mb-4 text-sm text-gray-600">
          Leurs offres sont lues directement sur leur page carrières chaque matin (Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters, Workday, Personio, Teamtailor). Les autres restent couvertes par les agrégateurs (Adzuna, France Travail).
        </p>
        <CompanyForm />
      </section>

      <section className="rounded-xl border bg-white p-4 sm:p-6">
        <h2 className="mb-1 font-semibold">Entreprises suggérées ({catalog.length})</h2>
        <p className="mb-4 text-sm text-gray-600">
          Catalogue partagé d&apos;employeurs vérifiés : leurs offres sont lisibles par l&apos;agent et ils recrutent en ce moment.
          Coche celles qui t&apos;intéressent et ajoute-les en une fois.
        </p>
        <CatalogPicker items={catalog} />
      </section>

      <section className="rounded-xl border bg-white p-4 sm:p-6">
        <h2 className="mb-1 font-semibold">Importer une liste</h2>
        <ImportCompaniesForm />
      </section>

      <section className="rounded-xl border bg-white">
        {companies.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">Aucune entreprise pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y">
            {companies.map(c => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm sm:px-6">
                <span className="min-w-0 break-words">
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-gray-500">{c.ats} · {c.slug}</span>
                </span>
                <form action={removeCompany.bind(null, c.id)}>
                  <button className="-my-1.5 px-1 py-1.5 text-red-600 hover:underline">Retirer</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

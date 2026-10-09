import { CompanyForm } from '../../components/CompanyForm';
import { removeCompany } from '../../actions';
import { listCompanies } from '@/db/dashboard';
import { requireUserId } from '@/lib/session';

export default async function CompaniesPage() {
  const userId = await requireUserId();
  const companies = await listCompanies(userId);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-6">
        <h1 className="mb-1 text-lg font-semibold">Entreprises suivies</h1>
        <p className="mb-4 text-sm text-gray-600">
          Leurs offres sont lues directement sur leur page carrières chaque matin (Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters, Workday). Les autres restent couvertes par Adzuna.
        </p>
        <CompanyForm />
      </section>

      <section className="rounded-xl border bg-white">
        {companies.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">Aucune entreprise pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y">
            {companies.map(c => (
              <li key={c.id} className="flex items-center justify-between px-6 py-3 text-sm">
                <span>
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-gray-500">{c.ats} · {c.slug}</span>
                </span>
                <form action={removeCompany.bind(null, c.id)}>
                  <button className="text-red-600 hover:underline">Retirer</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

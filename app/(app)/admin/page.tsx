import { DeleteUserButton } from '../../components/DeleteUserButton';
import { SettingsForm } from '../../components/SettingsForm';
import { listUsersWithStats, recentRuns } from '@/db/admin';
import { getSettings } from '@/db/settings';
import { describeRunError } from '@/lib/run-errors';
import { requireAdmin } from '@/lib/session';

const fmt = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '—';

const yesNo = (v: boolean) => (v ? '✓' : <span className="text-red-600">✗</span>);

export default async function AdminPage() {
  const adminId = await requireAdmin(); // 404 pour tout autre compte
  const [settings, users, runs] = await Promise.all([getSettings(), listUsersWithStats(), recentRuns(20)]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-6">
        <h1 className="mb-4 text-lg font-semibold">Administration · Réglages</h1>
        <SettingsForm initial={settings} userCount={users.length} />
      </section>

      <section className="rounded-xl border bg-white">
        <h2 className="border-b px-6 py-3 font-semibold">
          Utilisateurs ({users.length} / {settings.maxUsers})
        </h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="px-6 py-2">Compte</th><th>Inscrit le</th><th>CV</th><th>Clé</th><th>Offres</th><th>Dernière recherche</th><th />
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map(u => (
              <tr key={u.id}>
                <td className="px-6 py-2">
                  <div className="font-medium">{u.email}</div>
                  {u.name && <div className="text-xs text-gray-500">{u.name}</div>}
                </td>
                <td>{fmt(u.createdAt)}</td>
                <td>{yesNo(u.hasCv)}</td>
                <td>{yesNo(u.hasKey)}</td>
                <td>{u.offers}</td>
                <td>{fmt(u.lastRunAt)}</td>
                <td className="pr-6 text-right">
                  {u.id === adminId ? <span className="text-xs text-gray-400">toi</span> : <DeleteUserButton userId={u.id} email={u.email} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border bg-white">
        <h2 className="border-b px-6 py-3 font-semibold">20 dernières recherches (tous comptes)</h2>
        <ul className="divide-y text-sm">
          {runs.map(r => (
            <li key={r.id} className="px-6 py-2">
              <div className="flex flex-wrap gap-x-3">
                <span className="text-gray-500">{fmt(r.startedAt)}</span>
                <span className="font-medium">{r.email}</span>
                <span className={r.status === 'error' ? 'text-red-600' : r.status === 'running' ? 'text-amber-700' : 'text-green-700'}>
                  {r.status === 'error' ? 'échec' : r.status === 'running' ? 'en cours' : 'réussie'}
                </span>
                {r.stats && (
                  <span className="text-gray-500">
                    {r.stats.fetched ?? 0} collectées · {r.stats.new ?? 0} nouvelles · {r.stats.kept ?? 0} retenues
                  </span>
                )}
              </div>
              {r.status === 'error' && (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-gray-600">{describeRunError(r.error)}</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-all text-gray-400">{r.error}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

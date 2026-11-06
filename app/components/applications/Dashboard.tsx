import Link from 'next/link';
import type { Dashboard as Data, Segment, TodoItem } from '@/lib/application-stats';
import { GoalInput } from './GoalInput';

// Tableau de bord du suivi : composant SERVEUR (aucun JavaScript envoyé pour les graphiques).
// Les graphiques sont du SVG/HTML simple, colorés par variables CSS : ils suivent le mode sombre.
// Une seule couleur de série (bleu) : chaque graphique ne montre qu'une grandeur, la couleur
// n'a donc pas à distinguer des catégories. Les valeurs exactes sont au survol (title) et
// écrites en texte là où elles comptent.

const card = 'rounded-xl border bg-white p-4';
const BAR = 'var(--color-blue-600)';

function Kpi({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className={card}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
      {children}
    </div>
  );
}

function Funnel({ steps }: { steps: Data['funnel'] }) {
  const max = Math.max(steps[0]?.count ?? 0, 1);
  return (
    <ol className="space-y-2.5">
      {steps.map(s => (
        <li key={s.key} title={`${s.label} : ${s.count}`}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span>{s.label}</span>
            <span className="tabular-nums">
              <b>{s.count}</b>
              {s.rateFromPrev !== null && <span className="ml-2 text-xs text-gray-500">{s.rateFromPrev} % de l&apos;étape précédente</span>}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-gray-100">
            <div className="h-2.5 rounded-full" style={{ width: `${(s.count / max) * 100}%`, minWidth: s.count ? 4 : 0, background: BAR }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Weekly({ weeks, goal }: { weeks: Data['weeks']; goal: number }) {
  const W = 600, H = 170, top = 14, bottom = 22, left = 4;
  const max = Math.max(goal, ...weeks.map(w => w.count), 1);
  const plotH = H - top - bottom;
  const step = (W - left) / weeks.length;
  const bw = Math.min(28, step - 8);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Candidatures envoyées par semaine sur ${weeks.length} semaines, objectif ${goal}`}>
      <line x1={left} x2={W} y1={y(0)} y2={y(0)} stroke="var(--color-gray-200)" />
      {weeks.map((w, i) => {
        const x = left + i * step + (step - bw) / 2;
        const h = y(0) - y(w.count);
        const r = Math.min(4, h / 2, bw / 2); // coins arrondis en haut seulement, base posée sur l'axe
        return (
          <g key={w.start} className="group">
            <title>{`Semaine du ${w.label}${w.current ? ' (en cours)' : ''} : ${w.count} envoyée${w.count > 1 ? 's' : ''}`}</title>
            {/* zone de survol plus large que la barre */}
            <rect x={left + i * step} y={top} width={step} height={plotH} fill="transparent" />
            {w.count > 0 && (
              <path
                d={`M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
                fill={BAR}
                opacity={w.current ? 0.55 : 1}
                className="transition-opacity group-hover:opacity-80"
              />
            )}
            {(w.current || i % 2 === 1) && (
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-gray-500)">{w.current ? 'cette sem.' : w.label}</text>
            )}
            {w.current && w.count > 0 && (
              <text x={x + bw / 2} y={y(w.count) - 4} textAnchor="middle" fontSize="11" fill="var(--color-gray-700)">{w.count}</text>
            )}
          </g>
        );
      })}
      <line x1={left} x2={W} y1={y(goal)} y2={y(goal)} stroke="var(--color-gray-500)" strokeDasharray="4 4" />
      <text x={W - 2} y={y(goal) - 4} textAnchor="end" fontSize="11" fill="var(--color-gray-500)">objectif {goal}</text>
    </svg>
  );
}

function SegmentTable({ title, rows }: { title: string; rows: Segment[] }) {
  const max = Math.max(...rows.map(r => r.sent), 1);
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-gray-500">—</p> : (
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500">
            <tr><th className="pb-1 text-left font-normal" /><th className="pb-1 text-right font-normal">Envoyées</th><th className="pb-1 text-right font-normal">Réponse</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} title={`${r.label} : ${r.sent} envoyées, ${r.responded} réponses, ${r.interviewed} entretiens`}>
                <td className="py-1 pr-2">
                  <div className="truncate">{r.label}</div>
                  <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                    <div className="h-1.5 rounded-full" style={{ width: `${(r.sent / max) * 100}%`, background: BAR }} />
                  </div>
                </td>
                <td className="py-1 text-right tabular-nums">{r.sent}</td>
                <td className="py-1 pl-2 text-right tabular-nums">{r.responseRate} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Todo({ title, items, empty, hint }: { title: string; items: TodoItem[]; empty: string; hint: (i: TodoItem) => string }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title} <span className="text-gray-500">({items.length})</span></h3>
      {items.length === 0 ? <p className="text-sm text-gray-500">{empty}</p> : (
        <ul className="space-y-1.5 text-sm">
          {items.slice(0, 6).map(i => (
            <li key={i.id}>
              <Link href={`/applications?q=${encodeURIComponent(i.company)}`} className="hover:underline">
                <b>{i.company}</b>{i.title && <span className="text-gray-600"> · {i.title}</span>}
              </Link>
              <span className="ml-1 text-xs text-gray-500">{hint(i)}</span>
            </li>
          ))}
          {items.length > 6 && <li className="text-xs text-gray-500">et {items.length - 6} autre{items.length - 6 > 1 ? 's' : ''}…</li>}
        </ul>
      )}
    </div>
  );
}

const ago = (i: TodoItem) => (i.days === 0 ? 'aujourd’hui' : `il y a ${i.days} j`);

export function Dashboard({ d }: { d: Data }) {
  const progress = Math.min(100, Math.round((d.thisWeek / Math.max(d.goal, 1)) * 100));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Envoyées" value={String(d.sent)} hint="depuis le début" />
        <Kpi label="Cette semaine" value={`${d.thisWeek} / ${d.goal}`} hint={d.streak ? `${d.streak} semaine${d.streak > 1 ? 's' : ''} d’affilée à l’objectif` : undefined}>
          <div className="mt-2 h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full" style={{ width: `${progress}%`, background: BAR }} /></div>
          <p className="mt-1.5 text-xs text-gray-500"><GoalInput goal={d.goal} /></p>
        </Kpi>
        <Kpi label="Taux de réponse" value={`${d.responseRate} %`} hint="réponse positive ou non" />
        <Kpi label="Taux d’entretien" value={`${d.interviewRate} %`} hint="envoyées → échange" />
        <Kpi label="Délai de réponse" value={d.medianResponseDays === null ? '—' : `${d.medianResponseDays} j`} hint="médiane, envoi → 1re réponse" />
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <section className={`${card} lg:col-span-2`}>
          <h2 className="mb-3 text-sm font-medium">Entonnoir</h2>
          <Funnel steps={d.funnel} />
        </section>
        <section className={`${card} lg:col-span-3`}>
          <h2 className="mb-1 text-sm font-medium">Envoyées par semaine</h2>
          <p className="mb-2 text-xs text-gray-500">12 dernières semaines · survole une barre pour le détail</p>
          <Weekly weeks={d.weeks} goal={d.goal} />
        </section>
      </div>

      <section className={`${card} grid gap-5 md:grid-cols-3`}>
        {d.segments.map(s => <SegmentTable key={s.title} title={s.title} rows={s.rows} />)}
      </section>

      <section className={`${card} grid gap-5 md:grid-cols-3`}>
        <Todo title="À relancer" items={d.followUps} empty="Rien à relancer." hint={ago} />
        <Todo title="Échanges en cours" items={d.inConversation} empty="Aucun échange en cours." hint={i => `dernier contact ${ago(i)}`} />
        <Todo title="Sans nouvelles depuis 30 j" items={d.silent} empty="Aucune." hint={i => `${ago(i)} · à clore ?`} />
      </section>
    </div>
  );
}

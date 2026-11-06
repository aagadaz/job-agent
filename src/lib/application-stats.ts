// Statistiques du tableau de bord « Candidatures ». Module PUR : des lignes en entrée, des
// nombres en sortie, aucune base de données. On peut donc le tester avec des données fabriquées
// et il s'exécute sur le serveur (aucun calcul envoyé au navigateur).

import { SILENT_DAYS, STAGES, needsFollowUp, type Stage } from './applications';

export interface StatRow {
  id: string;
  company: string;
  title: string;
  stage: Stage;
  origin: string;
  companyType: string;
  contract: string;
  appliedAt: string | null;   // AAAA-MM-JJ
  respondedAt: string | null;
  interviewed: boolean;
  lastContact: string | null;
}

export interface FunnelStep { key: string; label: string; count: number; rateFromPrev: number | null }
export interface WeekBar { start: string; label: string; count: number; current: boolean }
export interface Segment { label: string; sent: number; responded: number; interviewed: number; responseRate: number }
export interface TodoItem { id: string; company: string; title: string; days: number; stage: Stage }

export interface Dashboard {
  sent: number;
  thisWeek: number;
  goal: number;
  streak: number;                 // semaines consécutives où l'objectif est atteint (semaine en cours exclue si pas finie)
  responseRate: number;           // % des envoyées qui ont reçu une réponse
  interviewRate: number;          // % des envoyées qui ont mené à un échange
  medianResponseDays: number | null;
  funnel: FunnelStep[];
  weeks: WeekBar[];
  segments: { title: string; rows: Segment[] }[];
  followUps: TodoItem[];          // à relancer
  inConversation: TodoItem[];     // échanges en cours
  silent: TodoItem[];             // sans nouvelles depuis 30 jours ou plus : à clore ?
}

const DAY = 86_400_000;
const WEEKS = 12;
const toTime = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Lundi (UTC) de la semaine qui contient t. */
function mondayOf(t: number): number {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // lundi = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function segmentBy(rows: StatRow[], key: (r: StatRow) => string, order?: string[]): Segment[] {
  const groups = new Map<string, StatRow[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  const segs = [...groups].map(([label, rs]) => {
    const responded = rs.filter(r => r.respondedAt).length;
    return { label, sent: rs.length, responded, interviewed: rs.filter(r => r.interviewed).length, responseRate: pct(responded, rs.length) };
  });
  // Ordre fixe pour les catégories de base, puis les autres (créées par Claude…) par volume
  const rank = (l: string) => (order?.includes(l) ? order.indexOf(l) : l === 'Non renseigné' ? 2000 : 1000);
  return segs.sort((a, b) => rank(a.label) - rank(b.label) || b.sent - a.sent);
}

export function computeDashboard(all: StatRow[], goal: number, now = new Date()): Dashboard {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sentRows = all.filter(r => r.stage !== 'not_started');
  const responded = sentRows.filter(r => r.respondedAt);
  const interviewed = sentRows.filter(r => r.interviewed);
  const committed = sentRows.filter(r => r.stage === 'committed');

  // Entonnoir : chaque étape est un sous-ensemble de la précédente (jalons qui ne reculent pas)
  const steps: [string, string, number][] = [
    ['sent', 'Envoyées', sentRows.length],
    ['responded', 'Réponse reçue', responded.length],
    ['interviewed', 'Entretien / échange', interviewed.length],
    ['committed', 'Offre acceptée', committed.length],
  ];
  const funnel = steps.map(([key, label, count], i) => ({ key, label, count, rateFromPrev: i === 0 ? null : pct(count, steps[i - 1][2]) }));

  // Délai de réponse : médiane (robuste aux valeurs extrêmes, contrairement à la moyenne).
  // Les lignes importées du Sheet sont exclues : on n'y connaît qu'UNE date (« Last contact »).
  const delays = responded
    .filter(r => r.origin !== 'sheet' && r.appliedAt && r.respondedAt)
    .map(r => (toTime(r.respondedAt!) - toTime(r.appliedAt!)) / DAY)
    .filter(d => d >= 0)
    .sort((a, b) => a - b);
  const medianResponseDays = delays.length
    ? Math.round(delays.length % 2 ? delays[(delays.length - 1) / 2] : (delays[delays.length / 2 - 1] + delays[delays.length / 2]) / 2)
    : null;

  // Activité : 12 dernières semaines (lundi → dimanche), semaine en cours incluse
  const thisMonday = mondayOf(today);
  const counts = new Map<number, number>();
  for (const r of sentRows) if (r.appliedAt) { const m = mondayOf(toTime(r.appliedAt)); counts.set(m, (counts.get(m) ?? 0) + 1); }
  const weeks: WeekBar[] = Array.from({ length: WEEKS }, (_, i) => {
    const start = thisMonday - (WEEKS - 1 - i) * 7 * DAY;
    const d = new Date(start);
    return { start: d.toISOString().slice(0, 10), label: `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`, count: counts.get(start) ?? 0, current: start === thisMonday };
  });
  // Série : semaines consécutives à l'objectif, en remontant depuis la dernière semaine TERMINÉE
  // (la semaine en cours compte si l'objectif y est déjà atteint)
  let streak = 0;
  const cur = weeks[weeks.length - 1];
  if (cur.count >= goal) streak++;
  for (let m = thisMonday - 7 * DAY; (counts.get(m) ?? 0) >= goal && goal > 0; m -= 7 * DAY) streak++;

  // À faire
  const daysSince = (d: string | null) => (d ? Math.floor((today - toTime(d)) / DAY) : 0);
  const item = (r: StatRow): TodoItem => ({ id: r.id, company: r.company, title: r.title, stage: r.stage, days: daysSince(r.lastContact ?? r.appliedAt) });
  const open = (s: Stage) => s === 'applied' || s === 'waiting';
  const followUps = all.filter(r => needsFollowUp(r.stage, r.lastContact, now)).map(item).sort((a, b) => b.days - a.days);
  const silent = all.filter(r => open(r.stage) && daysSince(r.lastContact ?? r.appliedAt) >= SILENT_DAYS).map(item).sort((a, b) => b.days - a.days);
  const inConversation = all.filter(r => r.stage === 'in_conversation').map(item).sort((a, b) => a.days - b.days);

  const ORIGINS: Record<string, string> = { agent: 'Trouvées par l’agent', manual: 'Ajoutées à la main', sheet: 'Importées du Sheet' };
  return {
    sent: sentRows.length,
    thisWeek: cur.count,
    goal,
    streak,
    responseRate: pct(responded.length, sentRows.length),
    interviewRate: pct(interviewed.length, sentRows.length),
    medianResponseDays,
    funnel,
    weeks,
    segments: [
      { title: 'Type d’entreprise', rows: segmentBy(sentRows, r => r.companyType || 'Non renseigné', ['AI & tech', 'Consulting', 'Financial services', 'Industry']) },
      { title: 'Contrat', rows: segmentBy(sentRows, r => r.contract || 'CDI') },
      { title: 'Origine', rows: segmentBy(sentRows, r => ORIGINS[r.origin] ?? r.origin) },
    ],
    followUps,
    inConversation,
    silent,
  };
}

export const stageLabel = (s: Stage) => STAGES[s].label;

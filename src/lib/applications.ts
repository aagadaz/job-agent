// Vocabulaire du suivi des candidatures. Module PUR (aucun import serveur) : partagé par les
// composants client et le serveur. Les libellés reprennent ceux du Google Sheet de suivi.

import type { ApplicationStatus } from './status';
import { fold } from './text';

export const STAGES = {
  not_started: { label: '1. Not started', tone: 'bg-red-50 text-red-700' },
  applied: { label: '2. Applied', tone: 'bg-amber-50 text-amber-800' },
  in_conversation: { label: '3. In conversation', tone: 'bg-blue-50 text-blue-800' },
  closed: { label: '4. Closed', tone: 'bg-gray-100 text-gray-600' },
  unsuccessful: { label: '5. Unsuccessful', tone: 'bg-gray-100 text-gray-500' },
  waiting: { label: '6. Waiting for response', tone: 'bg-amber-50 text-amber-700' },
  committed: { label: '7. Committed', tone: 'bg-green-50 text-green-800' },
} as const;
export type Stage = keyof typeof STAGES;
export const STAGE_KEYS = Object.keys(STAGES) as Stage[];

export const COMPANY_TYPES = ['AI & tech', 'Consulting', 'Financial services', 'Industry'] as const;
export const CONTRACTS = ['CDI', 'CDD', 'Stage', 'Alternance', 'Freelance', 'VIE'] as const;

/** Statut d'une offre dans le fil → étape de candidature correspondante. */
export const STATUS_TO_STAGE: Partial<Record<ApplicationStatus, Stage>> = {
  postule: 'applied',
  entretien: 'in_conversation',
  refuse: 'unsuccessful',
  abandonne: 'closed',
};

/**
 * Candidature à relancer : envoyée (ou en attente) sans nouvelles depuis RELANCE_DAYS jours…
 * mais moins de SILENT_DAYS : au-delà, une relance a peu de chances d'aboutir, on propose
 * plutôt de la clore (« Sans nouvelles depuis 30 j » dans le tableau de bord).
 */
export const RELANCE_DAYS = 10;
export const SILENT_DAYS = 30;
const daysSince = (d: string, today: Date) => (today.getTime() - new Date(`${d}T00:00:00Z`).getTime()) / 86_400_000;
export function needsFollowUp(stage: Stage, lastContact: string | null, today = new Date()): boolean {
  if (stage !== 'applied' && stage !== 'waiting') return false;
  if (!lastContact) return false;
  const d = daysSince(lastContact, today);
  return d >= RELANCE_DAYS && d < SILENT_DAYS;
}

/** Clé de rapprochement entreprise ↔ contacts : « Société Générale » = « societe generale ». */
export const companyKey = (name: string) => fold(name).replace(/\b(sa|sas|group|groupe)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ─── Jalons (pour le tableau de bord) ───
// L'étape courante ne suffit pas : une candidature « 5. Unsuccessful » a pu passer par un
// entretien. On mémorise donc des JALONS qui ne reculent jamais : date d'envoi, date de la
// 1re réponse, « a eu un entretien ».

/** Étapes qui signifient « l'entreprise a répondu » (positivement ou non). */
export const RESPONSE_STAGES: readonly Stage[] = ['in_conversation', 'unsuccessful', 'committed'];
/** Étapes qui signifient « il y a eu un échange / entretien ». */
export const INTERVIEW_STAGES: readonly Stage[] = ['in_conversation', 'committed'];

/** Libellé du Sheet (« 3. In conversation », « Refusé », « Applied »…) → étape. */
export function stageFromLabel(label: string): Stage | null {
  const t = fold(label).trim();
  if (!t) return null;
  const n = /^([1-7])\s*[.)\-:]?/.exec(t);
  if (n) return STAGE_KEYS[Number(n[1]) - 1];
  if (/not started|a faire|a postuler|pas commence/.test(t)) return 'not_started';
  if (/commit|accept|offre recue|signe|embauch/.test(t)) return 'committed';
  if (/conversation|entretien|interview|echange/.test(t)) return 'in_conversation';
  if (/unsuccess|refus|rejet|reject|negati/.test(t)) return 'unsuccessful';
  if (/wait|attente|relance/.test(t)) return 'waiting';
  if (/closed|abandon|ferme|clos/.test(t)) return 'closed';
  if (/appl|postul|envoy|candidat/.test(t)) return 'applied';
  return null;
}

/** Type d'entreprise saisi librement → valeur de la liste si on la reconnaît, sinon vide. */
export function companyTypeFrom(raw: string): (typeof COMPANY_TYPES)[number] | '' {
  const t = fold(raw).trim();
  if (!t) return '';
  if (/\b(ai|ia|tech|software|logiciel|startup|saas)\b/.test(t)) return 'AI & tech';
  if (/consult|esn|conseil/.test(t)) return 'Consulting';
  if (/financ|bank|banque|assurance|insurance/.test(t)) return 'Financial services';
  if (/indus|manufactur|energ|auto|aero/.test(t)) return 'Industry';
  return '';
}

/** Contrat saisi librement → valeur de la liste (CDI par défaut). */
export function contractFrom(raw: string): (typeof CONTRACTS)[number] {
  const t = fold(raw);
  if (/\bcdd\b|temporary/.test(t)) return 'CDD';
  if (/stage|intern/.test(t)) return 'Stage';
  if (/alternance|apprenti/.test(t)) return 'Alternance';
  if (/freelance|mission|independant|portage/.test(t)) return 'Freelance';
  if (/\bvie\b/.test(t)) return 'VIE';
  return 'CDI';
}

const MONTH_PREFIXES: [string, number][] = [
  ['janv', 0], ['jan', 0], ['fev', 1], ['feb', 1], ['mars', 2], ['mar', 2], ['avr', 3], ['apr', 3],
  ['mai', 4], ['may', 4], ['juin', 5], ['jun', 5], ['juil', 6], ['jul', 6], ['aou', 7], ['aug', 7],
  ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11],
];

/**
 * Date du Sheet → « AAAA-MM-JJ ». Accepte « 26 octobre » (sans année : on prend l'occurrence
 * la plus récente qui n'est pas dans le futur), « 26/10/2026 », « 2026-10-26 ».
 */
export function parseSheetDate(raw: string, today = new Date()): string | null {
  const s = fold(raw).trim();
  if (!s) return null;
  const iso = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m, d));
    if (dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null; // 31 février…
    return dt.toISOString().slice(0, 10);
  };
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return iso(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(s);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]);
  m = /^(\d{1,2})(?:er)?\s+([a-z]+)\.?(?:\s+(\d{4}))?$/.exec(s);
  if (!m) return null;
  const month = MONTH_PREFIXES.find(([p]) => m![2].startsWith(p))?.[1];
  if (month === undefined) return null;
  const day = +m[1];
  if (m[3]) return iso(+m[3], month, day);
  let year = today.getUTCFullYear();
  if (Date.UTC(year, month, day) > today.getTime() + 86_400_000) year -= 1; // « 26 décembre » vu en janvier
  return iso(year, month, day);
}

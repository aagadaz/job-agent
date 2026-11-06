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

/** Candidature à relancer : envoyée (ou en attente) sans nouvelles depuis RELANCE_DAYS jours. */
export const RELANCE_DAYS = 10;
export function needsFollowUp(stage: Stage, lastContact: string | null, today = new Date()): boolean {
  if (stage !== 'applied' && stage !== 'waiting') return false;
  if (!lastContact) return false;
  return (today.getTime() - new Date(`${lastContact}T00:00:00`).getTime()) / 86_400_000 >= RELANCE_DAYS;
}

/** Clé de rapprochement entreprise ↔ contacts : « Société Générale » = « societe generale ». */
export const companyKey = (name: string) => fold(name).replace(/\b(sa|sas|group|groupe)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

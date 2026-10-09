// Libellés des statuts de candidature. Module "pur" (aucun import serveur) : utilisable
// à la fois par les composants client (StatusSelect) et par le code serveur (Google Sheet).

export const STATUS_LABELS = {
  a_traiter: 'À traiter',
  postule: 'Postulé',
  entretien: 'Entretien',
  refuse: 'Refusé',
  abandonne: 'Abandonné',
} as const;

export type ApplicationStatus = keyof typeof STATUS_LABELS;

/** Statuts qui signifient « j'ai candidaté » : ils créent la ligne dans le Sheet si elle manque. */
export const APPLIED_STATUSES: readonly ApplicationStatus[] = ['postule', 'entretien', 'refuse'];

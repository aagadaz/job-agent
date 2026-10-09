import { getAccessToken, serviceAccountEmail } from './google-auth';
import { APPLIED_STATUSES, STATUS_LABELS, type ApplicationStatus } from './status';

// Suivi des candidatures dans le Google Sheet de chaque utilisateur, via l'API REST Sheets v4.

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TAB = 'Candidatures';
const HEADER = ['Date de candidature', 'Entreprise', 'Poste', 'Lieu', 'Score', 'Statut', 'Lien', 'Source'];
const STATUS_COL = 'F';
const LINK_COL = 'G';

export interface ApplicationRow {
  company: string;
  title: string;
  location: string;
  score: number | null;
  url: string;
  source: string;
}

/** Extrait l'identifiant d'un Sheet depuis son URL (ou accepte l'identifiant brut). */
export function parseSheetId(input: string): string | null {
  const s = input.trim();
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (fromUrl) return fromUrl[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
}

async function sheetsFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getAccessToken(SCOPE);
  const res = await fetch(`${API}/${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 403 || res.status === 404) {
    // 403/404 = le compte de service ne voit pas ce Sheet : cas le plus fréquent, message actionnable
    throw new Error(`Sheet inaccessible : partage-le (Éditeur) avec ${serviceAccountEmail() ?? 'le compte de service'}`);
  }
  if (!res.ok) {
    // Google renvoie toujours un JSON { error: { message } } : c'est LUI qui dit la vraie cause
    const detail = await res
      .json()
      .then((b: { error?: { message?: string } }) => b.error?.message ?? '')
      .catch(() => '');
    if (/not supported for this document/i.test(detail)) {
      throw new Error("Ce fichier est un Excel (.xlsx) stocké sur Drive, pas un Google Sheet natif : Fichier → Enregistrer au format Google Sheets, puis colle la nouvelle URL");
    }
    throw new Error(`API Google Sheets : HTTP ${res.status}${detail ? ` – ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}

const range = (a1: string) => encodeURIComponent(`${TAB}!${a1}`);

/** Crée l'onglet "Candidatures" et sa ligne d'en-tête s'ils n'existent pas (idempotent). */
export async function ensureApplicationsTab(sheetId: string): Promise<void> {
  const meta = await sheetsFetch<{ sheets: { properties: { title: string } }[] }>(
    `${sheetId}?fields=sheets.properties.title`,
  );
  if (!meta.sheets.some(s => s.properties.title.toLowerCase() === TAB.toLowerCase())) {
    await sheetsFetch(`${sheetId}:batchUpdate`, {
      method: 'POST',
      body: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
  }
  const head = await sheetsFetch<{ values?: string[][] }>(`${sheetId}/values/${range('A1:H1')}`);
  if (!head.values?.[0]?.length) {
    await sheetsFetch(`${sheetId}/values/${range('A1:H1')}?valueInputOption=RAW`, {
      method: 'PUT',
      body: { values: [HEADER] },
    });
  }
}

/**
 * Reporte un changement de statut dans le Sheet.
 * - La ligne de l'offre existe (repérée par son lien) → on met à jour la colonne Statut.
 * - Elle n'existe pas et le statut signifie « candidaté » → on ajoute la ligne.
 * - Sinon (ex. « À traiter ») → rien.
 */
export async function syncApplication(
  sheetId: string,
  status: ApplicationStatus,
  row: ApplicationRow,
): Promise<'updated' | 'appended' | 'skipped'> {
  await ensureApplicationsTab(sheetId);

  const links = await sheetsFetch<{ values?: string[][] }>(`${sheetId}/values/${range(`${LINK_COL}:${LINK_COL}`)}`);
  const index = (links.values ?? []).findIndex(r => r[0] === row.url);

  if (index > 0) { // index 0 = en-tête
    await sheetsFetch(`${sheetId}/values/${range(`${STATUS_COL}${index + 1}`)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: { values: [[STATUS_LABELS[status]]] },
    });
    return 'updated';
  }
  if (!APPLIED_STATUSES.includes(status)) return 'skipped';

  // RAW et non USER_ENTERED : un titre d'offre commençant par "=" ne doit JAMAIS devenir une formule
  await sheetsFetch(`${sheetId}/values/${range('A:H')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: {
      values: [[
        new Date().toISOString().slice(0, 10),
        row.company,
        row.title,
        row.location,
        row.score ?? '',
        STATUS_LABELS[status],
        row.url,
        row.source,
      ]],
    },
  });
  return 'appended';
}

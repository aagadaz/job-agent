import { getAccessToken, serviceAccountEmail } from './google-auth';
import { APPLIED_STATUSES, STATUS_LABELS, type ApplicationStatus } from './status';
import { fold } from './text';

// Suivi des candidatures dans le Google Sheet de chaque utilisateur, via l'API REST Sheets v4.
//
// Deux cas :
//  - aucun onglet choisi → onglet « Candidatures » créé par l'application, en-tête standard ;
//  - un onglet choisi (le #gid=… de l'URL collée dans le Profil) → on écrit DANS SON FORMAT :
//    on lit sa ligne d'en-tête, on reconnaît les colonnes par leur nom (Entreprise, Poste,
//    Réponses, Last contact…), et on imite le vocabulaire déjà utilisé (« 2. Applied »,
//    « 15 octobre »). Les colonnes inconnues sont laissées vides.

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DEFAULT_TAB = 'Candidatures';
const DEFAULT_HEADER = ['Date de candidature', 'Entreprise', 'Poste', 'Lieu', 'Score', 'Statut', 'Lien', 'Source'];
const HEADER_SCAN_ROWS = 5; // l'en-tête n'est pas toujours en ligne 1 (ligne de titre au-dessus)

export interface ApplicationRow {
  company: string;
  title: string;
  location: string;
  score: number | null;
  url: string;
  source: string;
  employmentType?: string;
}

/** Extrait l'identifiant d'un Sheet depuis son URL (ou accepte l'identifiant brut). */
export function parseSheetId(input: string): string | null {
  const s = input.trim();
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (fromUrl) return fromUrl[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
}

/** Onglet visé par l'URL (#gid=123 ou ?gid=123), ou null si l'URL n'en désigne pas. */
export function parseSheetGid(input: string): number | null {
  const m = /[#?&]gid=(\d{1,12})\b/.exec(input);
  return m ? Number(m[1]) : null;
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

// Nom d'onglet entre apostrophes (obligatoire s'il contient espaces ou caractères spéciaux)
const a1 = (tab: string, ref: string) => encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${ref}`);
const colLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colLetter(Math.floor(i / 26) - 1) + colLetter(i % 26));

// ─── Reconnaissance des colonnes ───

type Field = 'date' | 'company' | 'title' | 'location' | 'status' | 'url' | 'source' | 'score' | 'contract' | 'companyType' | 'notes' | 'contact';

// En-têtes reconnus (comparés en minuscules, sans accents). Une colonne « Contact » (une
// personne) n'est PAS une date : seuls des intitulés explicites sont acceptés.
const ALIASES: Record<Field, RegExp> = {
  date: /^(date|date de candidature|date candidature|last contact|dernier contact|candidature le)$/,
  company: /^(entreprise|societe|company|employeur)$/,
  title: /^(poste|poste \(lien\)|intitule|intitule du poste|titre du poste|job|offre)$/,
  location: /^(lieu|ville|localisation|location)$/,
  status: /^(statut|status|reponses?|etape|etat)$/,
  url: /^(lien|url|link|lien de l'offre)$/,
  source: /^(source)$/,
  score: /^(score|note)$/,
  contract: /^(type|contrat|type de contrat)$/,
  // Lus seulement à l'import (jamais écrits par la synchro)
  companyType: /^(type d.entreprise|type entreprise|secteur|industrie)$/,
  notes: /^(notes?|commentaires?|remarques?)$/,
  contact: /^(contacts?|personne de contact|interlocuteur|referent)$/,
};

interface Layout {
  tab: string;
  sheetGid: number;
  headerRow: number;                       // index 0 de la ligne d'en-tête
  cols: Partial<Record<Field, number>>;    // champ → index de colonne
  linkInTitle: boolean;                    // pas de colonne URL : le lien est posé sur l'intitulé
  statusLabel: (s: ApplicationStatus) => string;
  formatDate: (d: Date) => string;
  dateIsLastContact: boolean;              // « Last contact » : mise à jour à chaque changement de statut
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Vocabulaire « pipeline » numéroté (1. Not started, 2. Applied…) : on reprend les libellés
// existants de la colonne quand on les trouve, sinon ces valeurs par défaut.
const PIPELINE: Record<ApplicationStatus, { n: string; fallback: string }> = {
  a_traiter: { n: '1', fallback: '1. Not started' },
  postule: { n: '2', fallback: '2. Applied' },
  entretien: { n: '3', fallback: '3. In conversation' },
  abandonne: { n: '4', fallback: '4. Closed' },
  refuse: { n: '5', fallback: '5. Unsuccessful' },
};

function detectLayout(tab: string, sheetGid: number, rows: string[][]): Layout | null {
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const cols: Partial<Record<Field, number>> = {};
    rows[r].forEach((cell, i) => {
      const h = fold(cell ?? '').trim();
      for (const f of Object.keys(ALIASES) as Field[]) if (cols[f] === undefined && ALIASES[f].test(h)) cols[f] = i;
    });
    if (cols.company === undefined || cols.title === undefined || cols.status === undefined) continue;

    // Imiter le vocabulaire et le format déjà présents sous l'en-tête
    const below = rows.slice(r + 1);
    const statusValues = below.map(row => row[cols.status!] ?? '').filter(Boolean);
    const pipeline = statusValues.some(v => /^\d\.\s/.test(v));
    const statusLabel = (s: ApplicationStatus) => {
      if (!pipeline) return STATUS_LABELS[s];
      const { n, fallback } = PIPELINE[s];
      return statusValues.find(v => v.startsWith(`${n}.`)) ?? fallback;
    };
    const dateValues = cols.date === undefined ? [] : below.map(row => row[cols.date!] ?? '').filter(Boolean);
    const formatDate =
      dateValues.some(v => /^\d{1,2} [a-zéûô]+$/i.test(v)) ? (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`
      : dateValues.some(v => /^\d{2}\/\d{2}\/\d{4}$/.test(v)) ? (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
      : (d: Date) => d.toISOString().slice(0, 10);

    const dateHeader = cols.date === undefined ? '' : fold(rows[r][cols.date] ?? '');
    return {
      tab, sheetGid, headerRow: r, cols, linkInTitle: cols.url === undefined, statusLabel, formatDate,
      dateIsLastContact: /contact/.test(dateHeader), // « Date de candidature », elle, ne bouge plus
    };
  }
  return null;
}

async function loadLayout(spreadsheetId: string, gid: number | null): Promise<Layout> {
  const meta = await sheetsFetch<{ sheets: { properties: { sheetId: number; title: string } }[] }>(
    `${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
  );
  const sheet = gid === null
    ? meta.sheets.find(s => s.properties.title.toLowerCase() === DEFAULT_TAB.toLowerCase())
    : meta.sheets.find(s => s.properties.sheetId === gid);
  if (!sheet) {
    if (gid !== null) throw new Error("Onglet introuvable : l'onglet de l'URL a peut-être été supprimé. Recolle l'URL de l'onglet de suivi dans le Profil.");
    throw new Error('Onglet « Candidatures » absent : reconnecte le Sheet dans le Profil.');
  }
  const { title } = sheet.properties;
  // Les 200 premières lignes suffisent pour reconnaître l'en-tête et le vocabulaire utilisé
  const head = await sheetsFetch<{ values?: string[][] }>(`${spreadsheetId}/values/${a1(title, 'A1:Z200')}`);
  const layout = detectLayout(title, sheet.properties.sheetId, head.values ?? []);
  if (!layout) {
    throw new Error(`Onglet « ${title} » : en-tête non reconnu. Il faut au moins des colonnes Entreprise, Poste (ou Intitulé) et Statut (ou Réponses).`);
  }
  return layout;
}

/** Prépare l'onglet par défaut « Candidatures » (création + en-tête) s'il n'existe pas. */
export async function ensureApplicationsTab(spreadsheetId: string): Promise<void> {
  const meta = await sheetsFetch<{ sheets: { properties: { title: string } }[] }>(`${spreadsheetId}?fields=sheets.properties.title`);
  if (!meta.sheets.some(s => s.properties.title.toLowerCase() === DEFAULT_TAB.toLowerCase())) {
    await sheetsFetch(`${spreadsheetId}:batchUpdate`, { method: 'POST', body: { requests: [{ addSheet: { properties: { title: DEFAULT_TAB } } }] } });
  }
  const head = await sheetsFetch<{ values?: string[][] }>(`${spreadsheetId}/values/${a1(DEFAULT_TAB, 'A1:H1')}`);
  if (!head.values?.[0]?.length) {
    await sheetsFetch(`${spreadsheetId}/values/${a1(DEFAULT_TAB, 'A1:H1')}?valueInputOption=RAW`, { method: 'PUT', body: { values: [DEFAULT_HEADER] } });
  }
}

/**
 * Vérifie, à la connexion du Sheet, que l'onglet choisi est exploitable.
 * Renvoie le nom de l'onglet utilisé (pour le message de confirmation).
 */
export async function checkTrackingTab(spreadsheetId: string, gid: number | null): Promise<string> {
  if (gid === null) {
    await ensureApplicationsTab(spreadsheetId);
    return DEFAULT_TAB;
  }
  return (await loadLayout(spreadsheetId, gid)).tab;
}

function contractOf(employmentType = ''): string {
  const t = fold(employmentType);
  if (/\bcdd\b|temporary|contract/.test(t)) return 'CDD';
  if (/stage|intern/.test(t)) return 'Stage';
  if (/alternance|apprenti/.test(t)) return 'Alternance';
  if (/freelance|independant/.test(t)) return 'Freelance';
  return 'CDI';
}

// Une cellule pour l'API batchUpdate. stringValue n'est JAMAIS interprété comme une formule
// (même protection que valueInputOption=RAW) ; le lien passe par le formatage du texte.
function cell(value: string | number | null, link?: string) {
  if (value === null || value === '') return {};
  if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
  return {
    userEnteredValue: { stringValue: value },
    ...(link ? { textFormatRuns: [{ startIndex: 0, format: { link: { uri: link } } }] } : {}),
  };
}

/** Index (0) de la ligne de cette offre, retrouvée par son lien (colonne URL ou lien de l'intitulé). */
async function findRow(spreadsheetId: string, layout: Layout, url: string): Promise<number | null> {
  const col = colLetter(layout.linkInTitle ? layout.cols.title! : layout.cols.url!);
  if (!layout.linkInTitle) {
    const data = await sheetsFetch<{ values?: string[][] }>(`${spreadsheetId}/values/${a1(layout.tab, `${col}:${col}`)}`);
    const i = (data.values ?? []).findIndex((r, idx) => idx > layout.headerRow && r[0] === url);
    return i > 0 ? i : null;
  }
  // Lien posé sur le texte : il n'apparaît pas dans les valeurs, on lit le champ hyperlink des cellules
  const data = await sheetsFetch<{ sheets?: { data?: { rowData?: { values?: { hyperlink?: string }[] }[] }[] }[] }>(
    `${spreadsheetId}?ranges=${a1(layout.tab, `${col}:${col}`)}&fields=sheets.data.rowData.values.hyperlink`,
  );
  const rows = data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  const i = rows.findIndex((r, idx) => idx > layout.headerRow && r.values?.[0]?.hyperlink === url);
  return i > 0 ? i : null;
}

/**
 * Reporte un changement de statut dans le Sheet.
 * - La ligne de l'offre existe (repérée par son lien) → on met à jour le statut (et la date).
 * - Elle n'existe pas et le statut signifie « candidaté » → on ajoute la ligne, au format de l'onglet.
 * - Sinon (ex. « À traiter ») → rien.
 */
export async function syncApplication(
  spreadsheetId: string,
  gid: number | null,
  status: ApplicationStatus,
  row: ApplicationRow,
): Promise<'updated' | 'appended' | 'skipped'> {
  if (gid === null) await ensureApplicationsTab(spreadsheetId);
  const layout = await loadLayout(spreadsheetId, gid);
  const { cols } = layout;
  const today = layout.formatDate(new Date());

  const existing = await findRow(spreadsheetId, layout, row.url);
  if (existing !== null) {
    const data = [{ range: `'${layout.tab.replace(/'/g, "''")}'!${colLetter(cols.status!)}${existing + 1}`, values: [[layout.statusLabel(status)]] }];
    if (cols.date !== undefined && layout.dateIsLastContact) data.push({ range: `'${layout.tab.replace(/'/g, "''")}'!${colLetter(cols.date)}${existing + 1}`, values: [[today]] });
    await sheetsFetch(`${spreadsheetId}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data } });
    return 'updated';
  }
  if (!APPLIED_STATUSES.includes(status)) return 'skipped';

  // Construction de la ligne, colonne par colonne, selon l'en-tête reconnu
  const width = Math.max(...Object.values(cols).map(i => i ?? 0)) + 1;
  const values: ReturnType<typeof cell>[] = Array.from({ length: width }, () => ({}));
  const put = (f: Field, v: string | number | null, link?: string) => { if (cols[f] !== undefined) values[cols[f]!] = cell(v, link); };
  put('date', today);
  put('company', row.company);
  put('title', row.title, layout.linkInTitle ? row.url : undefined);
  put('location', row.location);
  put('status', layout.statusLabel(status));
  put('url', row.url);
  put('source', row.source);
  put('score', row.score);
  put('contract', contractOf(row.employmentType));

  // Ligne cible = juste après la dernière ligne remplie (repérée sur la colonne Entreprise).
  // On recopie d'abord le FORMAT et la VALIDATION (listes déroulantes) de la ligne du dessus,
  // pour que la nouvelle ligne ressemble aux autres, puis on écrit les valeurs.
  const companyCol = colLetter(cols.company!);
  const filled = await sheetsFetch<{ values?: string[][] }>(`${spreadsheetId}/values/${a1(layout.tab, `${companyCol}:${companyCol}`)}`);
  const target = Math.max((filled.values ?? []).length, layout.headerRow + 1); // index 0 de la nouvelle ligne
  const sheetId = layout.sheetGid;
  const rowRange = (r: number) => ({ sheetId, startRowIndex: r, endRowIndex: r + 1 });

  const requests: unknown[] = [{ insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: target, endIndex: target + 1 }, inheritFromBefore: target > 0 } }];
  if (target > layout.headerRow + 1) {
    for (const pasteType of ['PASTE_FORMAT', 'PASTE_DATA_VALIDATION']) {
      requests.push({ copyPaste: { source: rowRange(target - 1), destination: rowRange(target), pasteType } });
    }
  }
  requests.push({
    updateCells: {
      start: { sheetId, rowIndex: target, columnIndex: 0 },
      rows: [{ values }],
      fields: 'userEnteredValue,textFormatRuns',
    },
  });
  await sheetsFetch(`${spreadsheetId}:batchUpdate`, { method: 'POST', body: { requests } });
  return 'appended';
}

// ─── Import : lire les lignes existantes de l'onglet de suivi ───

export interface TrackedRow {
  company: string;
  companyType: string;
  title: string;
  url: string;        // colonne Lien, ou lien posé sur l'intitulé du poste
  contract: string;
  status: string;     // libellé brut (« 3. In conversation »)
  date: string;       // texte brut de la colonne date (« 26 octobre »)
  notes: string;
  contact: string;    // nom(s) de la colonne Contact, s'il y en a une
}

type GridCell = { formattedValue?: string; hyperlink?: string; textFormatRuns?: { format?: { link?: { uri?: string } } }[] };

const MAX_IMPORT_ROWS = 2000;

/**
 * Lit toutes les lignes remplies de l'onglet de suivi (celui du Profil, ou un autre gid).
 * On demande à l'API les valeurs AFFICHÉES et les liens (champ hyperlink, ou lien en texte
 * enrichi) : c'est souvent sur l'intitulé du poste que le lien de l'offre est posé.
 */
export async function readTrackingRows(spreadsheetId: string, gid: number | null): Promise<{ tab: string; rows: TrackedRow[] }> {
  const layout = await loadLayout(spreadsheetId, gid);
  const { cols } = layout;
  const width = Math.max(...Object.values(cols).map(i => i ?? 0)) + 1;
  const range = a1(layout.tab, `A${layout.headerRow + 2}:${colLetter(width - 1)}${layout.headerRow + 1 + MAX_IMPORT_ROWS}`);
  const data = await sheetsFetch<{ sheets?: { data?: { rowData?: { values?: GridCell[] }[] }[] }[] }>(
    `${spreadsheetId}?ranges=${range}&fields=sheets.data.rowData.values(formattedValue,hyperlink,textFormatRuns.format.link.uri)`,
  );
  const grid = data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  const get = (r: GridCell[], f: Field) => (cols[f] === undefined ? '' : (r[cols[f]!]?.formattedValue ?? '').trim());
  const linkOf = (c?: GridCell) => c?.hyperlink ?? c?.textFormatRuns?.find(t => t.format?.link?.uri)?.format?.link?.uri ?? '';

  const rows: TrackedRow[] = [];
  for (const { values = [] } of grid) {
    const company = get(values, 'company');
    const title = get(values, 'title');
    if (!company) continue; // ligne vide, ou ligne de séparation
    const urlCell = cols.url !== undefined ? get(values, 'url') : '';
    rows.push({
      company, title,
      companyType: get(values, 'companyType'),
      url: /^https?:\/\//i.test(urlCell) ? urlCell : linkOf(values[cols.url ?? cols.title!]) || linkOf(values[cols.title!]),
      contract: get(values, 'contract'),
      status: get(values, 'status'),
      date: get(values, 'date'),
      notes: get(values, 'notes'),
      contact: get(values, 'contact'),
    });
  }
  return { tab: layout.tab, rows };
}

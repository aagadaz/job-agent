import { google, sheets_v4 } from 'googleapis';
import type { ScoredOffer } from './types';

const SHEET_NAME = 'candidatures';
const REJECTED_SHEET_NAME = 'rejetees';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// Les nouvelles colonnes sont AJOUTÉES À LA FIN (K → P) : les lignes déjà
// présentes dans le Sheet restent alignées avec leurs en-têtes.
const HEADERS = [
  'Titre',                  // A
  'Entreprise',             // B
  'Lieu',                   // C
  'Salaire',                // D
  'Type de contrat',        // E
  'Date de publication',    // F
  'Description',            // G
  'Qualifications',         // H
  'URL',                    // I  ← clé de déduplication
  'Statut',                 // J  ← géré à la main, jamais réécrit
  'Score',                  // K
  'Verdict',                // L
  'Justification',          // M
  'Points forts',           // N
  'Compétences manquantes', // O
  "Date d'ajout",           // P
];

// Onglet "mémoire" des offres écartées : juste assez pour ne pas les re-noter.
const REJECTED_HEADERS = ['URL', 'Score', 'Titre', 'Justification', "Date d'ajout"];

const MAX_CELL_LENGTH = 49_000; // limite Google Sheets : 50 000 caractères par cellule

let sheetsClient: sheets_v4.Sheets | null = null;

function getSheets(): sheets_v4.Sheets {
  // Singleton : un seul client authentifié pour toute l'exécution.
  if (!sheetsClient) {
    // En CI, la clé du compte de service arrive en JSON dans une variable d'environnement ;
    // en local, on garde le fichier credentials.json.
    const json = process.env.GOOGLE_CREDENTIALS_JSON;
    const auth = new google.auth.GoogleAuth({
      ...(json ? { credentials: JSON.parse(json) } : { keyFile: process.env.GOOGLE_CREDENTIALS_PATH }),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

/**
 * Normalise une URL pour qu'une même offre ait toujours la même clé :
 * on retire la query string et le fragment (paramètres de tracking / de recherche).
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.origin}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}

/** Lettre de colonne pour un index 1-based (1 → A, 16 → P). Suffit jusqu'à Z. */
function columnLetter(n: number): string {
  return String.fromCharCode(64 + n);
}

/** Crée l'onglet s'il n'existe pas. Idempotent. */
async function ensureTab(title: string): Promise<void> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.title',
  });
  const exists = res.data.sheets?.some(s => s.properties?.title === title);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  console.log(`✅ Onglet "${title}" créé`);
}

/** Écrit la ligne d'en-têtes uniquement si elle est absente ou différente. Idempotent. */
async function ensureHeaderRow(tab: string, headers: string[]): Promise<void> {
  const sheets = getSheets();
  const last = columnLetter(headers.length);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A1:${last}1`,
  });
  const current = res.data.values?.[0] ?? [];
  if (headers.every((h, i) => current[i] === h)) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
  console.log(`✅ En-têtes de "${tab}" mis à jour`);
}

/** Prépare les deux onglets (création + en-têtes). */
export async function ensureHeaders(): Promise<void> {
  await ensureTab(SHEET_NAME);
  await ensureHeaderRow(SHEET_NAME, HEADERS);
  await ensureTab(REJECTED_SHEET_NAME);
  await ensureHeaderRow(REJECTED_SHEET_NAME, REJECTED_HEADERS);
}

/** URLs (normalisées) déjà vues : offres retenues ET offres écartées. */
export async function getExistingUrls(): Promise<Set<string>> {
  const res = await getSheets().spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: [`${SHEET_NAME}!I2:I`, `${REJECTED_SHEET_NAME}!A2:A`],
  });
  const urls = (res.data.valueRanges ?? [])
    .flatMap(range => range.values ?? [])
    .map(row => row[0])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map(normalizeUrl);
  return new Set(urls);
}

function truncate(value: string): string {
  return value.length > MAX_CELL_LENGTH ? value.slice(0, MAX_CELL_LENGTH) + '…' : value;
}

async function appendRows(tab: string, rows: (string | number)[][]): Promise<void> {
  await getSheets().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

/** Ajoute les offres retenues en fin de tableau. Ne modifie jamais les lignes existantes. */
export async function appendOffers(offers: ScoredOffer[]): Promise<void> {
  if (offers.length === 0) {
    console.log('ℹ️ Aucune nouvelle offre à ajouter');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  await appendRows(SHEET_NAME, offers.map(o => [
    o.title,
    o.company,
    o.location,
    o.salary,
    o.employmentType,
    o.datePosted,
    truncate(o.description),
    truncate(o.qualifications),
    normalizeUrl(o.url),
    'À traiter',
    o.scoring?.score ?? '',
    o.scoring?.verdict ?? 'Non noté',
    o.scoring?.justification ?? '',
    o.scoring?.strengths.join(' • ') ?? '',
    o.scoring?.missingSkills.join(' • ') ?? '',
    today,
  ]));
  console.log(`✅ ${offers.length} offres ajoutées à "${SHEET_NAME}"`);
}

/** Mémorise les offres écartées pour ne pas les re-noter aux prochaines exécutions. */
export async function appendRejected(offers: ScoredOffer[]): Promise<void> {
  if (offers.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  await appendRows(REJECTED_SHEET_NAME, offers.map(o => [
    normalizeUrl(o.url),
    o.scoring?.score ?? '',
    o.title,
    o.scoring?.justification ?? '',
    today,
  ]));
  console.log(`🗑️ ${offers.length} offres écartées mémorisées dans "${REJECTED_SHEET_NAME}"`);
}

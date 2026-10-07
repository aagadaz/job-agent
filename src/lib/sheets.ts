import { google, sheets_v4 } from 'googleapis';
import * as dotenv from 'dotenv';
import type { ScoredOffer } from './types';

dotenv.config();

const SHEET_NAME = 'candidatures';
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

const URL_COLUMN = 'I';
const LAST_COLUMN = 'P';
const MAX_CELL_LENGTH = 49_000; // limite Google Sheets : 50 000 caractères par cellule

let sheetsClient: sheets_v4.Sheets | null = null;

function getSheets(): sheets_v4.Sheets {
  // Singleton : un seul client authentifié pour toute l'exécution.
  if (!sheetsClient) {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
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

/** Écrit les en-têtes uniquement s'ils sont absents ou ont changé. Idempotent. */
export async function ensureHeaders(): Promise<void> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:${LAST_COLUMN}1`,
  });
  const current = res.data.values?.[0] ?? [];
  const upToDate = HEADERS.every((h, i) => current[i] === h);
  if (upToDate) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  });
  console.log('✅ En-têtes mis à jour');
}

/** Renvoie l'ensemble des URLs (normalisées) déjà présentes dans le Sheet. */
export async function getExistingUrls(): Promise<Set<string>> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!${URL_COLUMN}2:${URL_COLUMN}`,
  });
  const urls = (res.data.values ?? [])
    .map(row => row[0])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map(normalizeUrl);
  return new Set(urls);
}

function truncate(value: string): string {
  return value.length > MAX_CELL_LENGTH ? value.slice(0, MAX_CELL_LENGTH) + '…' : value;
}

/** Ajoute les offres en fin de tableau. Ne modifie jamais les lignes existantes. */
export async function appendOffers(offers: ScoredOffer[]): Promise<void> {
  if (offers.length === 0) {
    console.log('ℹ️ Aucune nouvelle offre à ajouter');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = offers.map(o => [
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
  ]);

  await getSheets().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });

  console.log(`✅ ${rows.length} offres ajoutées au Google Sheet`);
}
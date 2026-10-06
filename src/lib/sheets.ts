import { google } from 'googleapis';
import * as dotenv from 'dotenv';

dotenv.config();

const HEADERS = [
  'Titre',
  'Entreprise',
  'Lieu',
  'Salaire',
  'Type de contrat',
  'Date de publication',
  'Description',
  'Qualifications',
  'URL',
  'Statut',
];

async function getSheet() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  return sheets;
}

export async function initSheet() {
  const sheets = await getSheet();

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'candidatures!A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [HEADERS],
    },
  });

  console.log('✅ Headers créés');
}

export async function appendOffers(offers: any[]) {
  const sheets = await getSheet();

  const rows = offers.map(offer => [
    offer.title,
    offer.company,
    offer.location,
    offer.salary,
    offer.employmentType,
    offer.datePosted,
    offer.description,
    offer.qualifications,
    offer.url ?? '',
    'À traiter',
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'candidatures!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: rows,
    },
  });

  console.log(`✅ ${rows.length} offres ajoutées au Google Sheet`);
}

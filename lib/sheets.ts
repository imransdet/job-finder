import 'dotenv/config';
import { google } from 'googleapis';

export interface JobRow {
  title: string;
  company: string;
  location: string;
  workplace: string;
  employmentType: string;
  salary: string;
  posted: string;
  badge: string;
  url: string;
  description: string;
  foundVia: string;
  scrapedAt: string;
}

export const HEADER = [
  'Title',
  'Company',
  'Location',
  'Workplace',
  'Employment Type',
  'Salary',
  'Posted',
  'Badge',
  'URL',
  'Description',
  'Found Via (search terms)',
  'Scraped At',
];

function getSheetsClient() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY in .env');
  }
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/** Ensure the target tab exists; create it if missing. */
async function ensureTab(spreadsheetId: string, sheetName: string) {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === sheetName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  }
}

/**
 * Writes the collected jobs to the sheet: clears the tab, writes the header,
 * then the data rows (a fresh snapshot, so re-runs don't duplicate).
 */
export async function writeJobsToSheet(jobs: JobRow[]) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME;
  if (!spreadsheetId || !sheetName) {
    throw new Error('Missing GOOGLE_SHEET_ID / GOOGLE_SHEET_NAME in .env');
  }

  const sheets = getSheetsClient();
  await ensureTab(spreadsheetId, sheetName);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}`,
  });

  const values = [
    HEADER,
    ...jobs.map((j) => [
      j.title,
      j.company,
      j.location,
      j.workplace,
      j.employmentType,
      j.salary,
      j.posted,
      j.badge,
      j.url,
      j.description,
      j.foundVia,
      j.scrapedAt,
    ]),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  return { spreadsheetId, sheetName, rows: jobs.length };
}

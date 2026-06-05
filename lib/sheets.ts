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
  matchScore: number;
  matchReason: string;
}

export const HEADER = [
  'Match Score',
  'Match Reason',
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

function rowToValues(j: JobRow): (string | number)[] {
  return [
    j.matchScore,
    j.matchReason,
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
  ];
}

function getConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME;
  if (!spreadsheetId || !sheetName) {
    throw new Error('Missing GOOGLE_SHEET_ID / GOOGLE_SHEET_NAME in .env');
  }
  return { spreadsheetId, sheetName };
}

/**
 * Normalize the service-account private key from an env var / GitHub secret.
 * Handles: accidental surrounding quotes, escaped "\n" sequences, and stray
 * CRs — any of which otherwise yield "DECODER routines::unsupported".
 */
function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n').replace(/\r/g, '');
}

function getSheetsClient() {
  const email = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  const key = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY ?? '');
  if (!email || !key) {
    throw new Error('Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY in .env');
  }
  if (!key.includes('BEGIN PRIVATE KEY')) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY does not look like a PEM key. In GitHub, paste the ' +
      'private_key value WITHOUT surrounding quotes (keep the \\n escapes, or ' +
      'paste the multi-line PEM as-is).'
    );
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

/** Clear the tab and write just the header row (call once at the start of a run). */
export async function initSheet() {
  const { spreadsheetId, sheetName } = getConfig();
  const sheets = getSheetsClient();
  await ensureTab(spreadsheetId, sheetName);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: sheetName });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER] },
  });
}

/** Append one or more job rows to the bottom of the tab. */
export async function appendJobs(jobs: JobRow[]) {
  if (jobs.length === 0) return;
  const { spreadsheetId, sheetName } = getConfig();
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: jobs.map(rowToValues) },
  });
}

/**
 * Read all data rows, sort by Match Score (desc), keep the top N, and rewrite
 * the tab (header + the top N rows only).
 */
export async function keepTopJobs(n: number) {
  const { spreadsheetId, sheetName } = getConfig();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
  const rows = res.data.values ?? [];
  const dataRows = rows.slice(1); // drop header
  // Match Score is column A (index 0).
  dataRows.sort((a, b) => Number(b[0] || 0) - Number(a[0] || 0));
  const top = dataRows.slice(0, n);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: sheetName });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER, ...top] },
  });
  return { kept: top.length, total: dataRows.length };
}

/**
 * One-shot snapshot writer (clears the tab, writes header + all rows). Used by
 * the simpler single-search specs that don't score/trim.
 */
export async function writeJobsToSheet(jobs: JobRow[]) {
  const { spreadsheetId, sheetName } = getConfig();
  const sheets = getSheetsClient();
  await ensureTab(spreadsheetId, sheetName);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: sheetName });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER, ...jobs.map(rowToValues)] },
  });
  return { spreadsheetId, sheetName, rows: jobs.length };
}

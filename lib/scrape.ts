import { Page } from '@playwright/test';
import { JobRow } from './sheets';
import { JobCard } from '../tests/pages/XingJobSearchPage';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function textByTestId(page: Page, testId: string): Promise<string> {
  const loc = page.getByTestId(testId).first();
  if (await loc.count().catch(() => 0)) {
    return clean(await loc.innerText().catch(() => ''));
  }
  return '';
}

/** Navigate to a single job detail page and extract every available field. */
export async function scrapeJobDetail(page: Page, card: JobCard): Promise<JobRow> {
  const url = card.url;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('job-details-title').first().waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(800);

  const title = await textByTestId(page, 'job-details-title');
  const company = await textByTestId(page, 'job-details-company-info-name');
  const location = await textByTestId(page, 'company-card-location');

  // "11 hours ago Posted 11 hours ago" -> "11 hours ago"
  const postedRaw = await textByTestId(page, 'job-details-published-date');
  const posted = clean(postedRaw.replace(/Posted.*/i, ''));

  // Expand the description if there's a "Show more" toggle, then read it.
  const showMore = page.getByRole('button', { name: /show more|mehr anzeigen/i }).first();
  if (await showMore.count().catch(() => 0)) {
    await showMore.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const description = await textByTestId(page, 'expandable-content');

  // Body text for regex-based facts (employment type, workplace, salary).
  const bodyText = clean(await page.locator('main, body').first().innerText().catch(() => ''));

  // Employment type / workplace: prefer the labelled fact, fall back to card.
  const employmentType =
    bodyText.match(/Employment type:?\s*(Full-time|Part-time|Working Student|Internship|Contract|Temporary|Freelance|Mini job)/i)?.[1] ??
    card.employmentType ??
    '';

  const workplace = bodyText.match(/\b(On-site|Hybrid|Full Remote|Remote)\b/i)?.[1] ?? '';

  // Salary: the listing card has the clean "€x – €y" range; fall back to page.
  const salary =
    card.salary ||
    (bodyText.match(/€\s?[\d.,]+\s*[–-]\s*€?\s?[\d.,]+/)?.[0]?.replace(/\s+/g, ' ').trim() ?? '');

  return {
    title,
    company,
    location,
    workplace,
    employmentType,
    salary,
    posted: posted || card.posted,
    badge: card.badge,
    url: page.url(),
    description,
    foundVia: '',
    scrapedAt: new Date().toISOString(),
  };
}

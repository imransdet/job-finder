import { Page } from '@playwright/test';
import { JobRow } from './sheets';
import { LinkedInJobCard } from '../tests/pages/LinkedInJobSearchPage';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Navigate to a LinkedIn job detail page and scrape all available fields. */
export async function scrapeLinkedInDetail(page: Page, card: LinkedInJobCard): Promise<JobRow> {
  await page.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(1500);

  // Expand description if there's a "Show more" button
  const showMore = page.getByRole('button', { name: /show more/i }).first();
  if (await showMore.count().catch(() => 0)) {
    await showMore.click().catch(() => {});
    await page.waitForTimeout(400);
  }

  // Multiple selector fallbacks to handle LinkedIn's evolving UI
  const title = clean(
    await page.locator('h1.top-card-layout__title, h1.jobs-unified-top-card__job-title, h1').first().innerText().catch(() => '')
  ) || card.title;

  const company = clean(
    await page.locator(
      'a.topcard__org-name-link, .topcard__flavor--spaced a, ' +
      '.job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a'
    ).first().innerText().catch(() => '')
  ) || card.company;

  const location = clean(
    await page.locator(
      'span.topcard__flavor--bullet, .job-details-jobs-unified-top-card__bullet, ' +
      '.jobs-unified-top-card__bullet'
    ).first().innerText().catch(() => '')
  ) || card.location;

  const description = clean(
    await page.locator(
      'div.show-more-less-html__markup, div.description__text, ' +
      '.jobs-description__content, .job-details-jobs-unified-top-card__job-description'
    ).first().innerText().catch(() => '')
  );

  // Criteria items: Employment type, Seniority, Workplace type
  let employmentType = '';
  let workplace = '';
  const criteriaItems = page.locator('li.description__job-criteria-item');
  const nCriteria = await criteriaItems.count().catch(() => 0);
  for (let i = 0; i < nCriteria; i++) {
    const item = criteriaItems.nth(i);
    const label = clean(await item.locator('h3').first().innerText().catch(() => '')).toLowerCase();
    const value = clean(await item.locator('span.description__job-criteria-text').first().innerText().catch(() => ''));
    if (label.includes('employment')) employmentType = value;
    if (label.includes('workplace') || label.includes('work type') || label.includes('remote')) workplace = value;
  }

  // Salary: card already has it if shown; otherwise grep body text
  const bodyText = clean(await page.locator('main, body').first().innerText().catch(() => ''));
  const salaryFromBody = bodyText.match(/€\s?[\d.,]+\s*[–\-]\s*€?\s?[\d.,]+/)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const salary = card.salary || salaryFromBody;

  return {
    title,
    company,
    location,
    workplace,
    employmentType,
    salary,
    posted: card.posted,
    badge: card.badge,
    url: page.url(),
    description,
    foundVia: '',
    scrapedAt: new Date().toISOString(),
    matchScore: 0,
    matchReason: '',
  };
}

import { Page } from '@playwright/test';
import { JobRow } from './sheets';
import { BAJobCard } from '../tests/pages/ArbeitsagenturJobSearchPage';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Navigate to a BA job detail page and scrape all available fields. */
export async function scrapeBADetail(page: Page, card: BAJobCard): Promise<JobRow> {
  await page.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(1500);

  // Wait for the job detail region to render.
  await page.locator('main article h1').first().waitFor({ timeout: 15_000 }).catch(() => {});

  // Title: scoped to the article inside the job detail region — avoids the
  // navigation's h1 ("Hauptnavigation") which appears first in the DOM.
  const title = clean(
    await page.locator('main article h1').first().innerText().catch(() => '')
  ) || card.title;

  // Company: extracted from the "Unternehmensdarstellung: {company}" region label.
  const companyRegionLabel = await page
    .locator('[aria-label^="Unternehmensdarstellung"]').first()
    .getAttribute('aria-label').catch(() => '') ?? '';
  const company = companyRegionLabel.replace(/^Unternehmensdarstellung:\s*/i, '').trim() || card.company;

  // Expand job description if "Mehr anzeigen" button is present.
  const showMore = page.getByRole('button', { name: /Mehr anzeigen/i }).first();
  if (await showMore.count().catch(() => 0)) {
    await showMore.click().catch(() => {});
    await page.waitForTimeout(400);
  }

  const description = clean(
    await page.locator('[aria-label="Stellenbeschreibung"]').first().innerText().catch(() => '')
  );

  // Structured fields from the Kopfbereich — use evaluate() to read sibling
  // text content after each labeled heading reliably.
  const { location, employmentType, workplace } = await page.evaluate(() => {
    const get = (label: string) => {
      const h4 = Array.from(document.querySelectorAll('main h4')).find(
        (el) => el.textContent?.trim() === label
      );
      return (h4?.nextElementSibling as HTMLElement | null)?.innerText?.trim() ?? '';
    };
    const homeoffice = Array.from(document.querySelectorAll('main li')).some((li) =>
      /homeoffice/i.test(li.textContent ?? '')
    );
    return {
      location: get('Arbeitsort'),
      employmentType: get('Anstellungsart'),
      workplace: homeoffice ? 'Hybrid' : '',
    };
  }).catch(() => ({ location: '', employmentType: '', workplace: '' }));

  const bodyText = clean(await page.locator('main').first().innerText().catch(() => ''));
  const salary =
    bodyText.match(/€\s?[\d.,]+(?:\s*[–\-]\s*€?\s?[\d.,]+)?/)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';

  return {
    title,
    company,
    location: location || card.location || '',
    workplace,
    employmentType,
    salary,
    posted: card.posted,
    badge: '',
    url: page.url(),
    description,
    foundVia: '',
    scrapedAt: new Date().toISOString(),
    matchScore: 0,
    matchReason: '',
  };
}

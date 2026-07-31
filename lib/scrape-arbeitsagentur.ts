import { Page } from '@playwright/test';
import { JobRow } from './sheets';
import { ArbeitsagenturJobCard } from '../tests/pages/ArbeitsagenturJobSearchPage';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Navigate to an Arbeitsagentur job detail page and scrape all available fields. */
export async function scrapeArbeitsagenturDetail(page: Page, card: ArbeitsagenturJobCard): Promise<JobRow> {
  await page.goto(card.url, { waitUntil: 'networkidle', timeout: 30_000 });

  const bodyText = clean(await page.locator('body').first().innerText().catch(() => ''));

  // Description: text block that follows the "Stellenbeschreibung" heading
  const description = (() => {
    const marker = 'Stellenbeschreibung';
    const idx = bodyText.indexOf(marker);
    if (idx === -1) return '';
    const after = bodyText.slice(idx + marker.length).trimStart();
    // Cut off at UI chrome that appears after the description
    const endMarkers = ['Info zur Bewerbung', 'Vormerken', 'PDF / Drucken', 'Teilen'];
    let end = after.length;
    for (const m of endMarkers) {
      const i = after.indexOf(m);
      if (i !== -1 && i < end) end = i;
    }
    return after.slice(0, end).trim();
  })();

  const salary =
    bodyText.match(/€\s?[\d.,]+(?:\s*[–\-]\s*€?\s?[\d.,]+)?/)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';

  return {
    title: card.title,
    company: card.company,
    location: card.location,
    workplace: card.workplace,
    employmentType: card.employmentType,
    salary,
    posted: card.posted,
    badge: '',
    url: card.url,
    description: clean(description),
    foundVia: '',
    scrapedAt: new Date().toISOString(),
    matchScore: 0,
    matchReason: '',
  };
}

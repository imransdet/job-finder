import { Page } from '@playwright/test';
import { JobRow } from './sheets';
import { GlassdoorJobCard } from '../tests/pages/GlassdoorJobSearchPage';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Navigate to a Glassdoor job detail page and scrape all available fields. */
export async function scrapeGlassdoorDetail(page: Page, card: GlassdoorJobCard): Promise<JobRow> {
  await page.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(1500);

  // Expand description if "Mehr anzeigen" button is present
  const showMore = page.getByRole('button', { name: /Mehr anzeigen/i }).first();
  if (await showMore.count().catch(() => 0)) {
    await showMore.click().catch(() => {});
    await page.waitForTimeout(400);
  }

  // Title: the h1 on the page is always the job title
  const title =
    clean(await page.locator('h1').first().innerText().catch(() => '')) || card.title;

  // Company: the h4 inside the header/banner area
  const company =
    clean(await page.locator('header h4').first().innerText().catch(() => '')) || card.company;

  // Location: structurally it lives in the sibling element right after the
  // title/company section inside the page header. Walk the DOM to find it.
  const location = await page.evaluate(() => {
    const h1 = document.querySelector('header h1');
    if (!h1) return '';
    // h1 → its container → container's parent → next sibling holds location text
    const titleBlock = h1.closest('div') ?? h1.parentElement;
    const locationEl = titleBlock?.parentElement?.nextElementSibling;
    return locationEl?.textContent?.trim() ?? '';
  }).catch(() => '') || card.location;

  // Description: the first substantial text block after the header. Walk
  // header's siblings until we find one with meaningful length.
  const description = await page.evaluate(() => {
    const header = document.querySelector('header');
    if (!header) return '';
    let el = header.nextElementSibling;
    while (el) {
      const text = el.textContent?.trim() ?? '';
      if (text.length > 80) return text;
      el = el.nextElementSibling;
    }
    return '';
  }).catch(() => '');

  const bodyText = clean(await page.locator('body').first().innerText().catch(() => ''));

  const salary =
    card.salary ||
    bodyText.match(/€\s?[\d.,]+(?:\s*[–\-]\s*€?\s?[\d.,]+)?/)?.[0]?.replace(/\s+/g, ' ').trim() ??
    '';

  const employmentType =
    bodyText.match(/\b(Vollzeit|Teilzeit|Freelance|Praktikum|Werkstudent|Full-time|Part-time|Contract)\b/i)?.[1] ?? '';

  const workplace = /\bhybrid\b/i.test(bodyText)
    ? 'Hybrid'
    : /\b(remote|homeoffice)\b/i.test(bodyText)
    ? 'Remote'
    : '';

  return {
    title,
    company,
    location,
    workplace,
    employmentType,
    salary,
    posted: card.posted,
    badge: '',
    url: page.url(),
    description: clean(description),
    foundVia: '',
    scrapedAt: new Date().toISOString(),
    matchScore: 0,
    matchReason: '',
  };
}

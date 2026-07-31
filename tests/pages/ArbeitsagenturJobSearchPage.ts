import { Page } from '@playwright/test';

export interface ArbeitsagenturJobCard {
  jobId: string;
  url: string;
  title: string;
  company: string;
  location: string;
  posted: string;
  employmentType: string;
  workplace: string;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Page Object for Arbeitsagentur (Federal Employment Agency) job search.
 * Government site — no bot protection, no Cloudflare. Bundled Chromium works fine.
 * URL param `veroeffentlichtseit` controls date range: 1=24h, 7=week, 30=month.
 * Selectors verified against www.arbeitsagentur.de (July 2026).
 */
export class ArbeitsagenturJobSearchPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private sincePeriodToDays(sincePeriod: string): string {
    const map: Record<string, string> = {
      LAST_24_HOURS: '1',
      LAST_WEEK: '7',
      LAST_MONTH: '30',
    };
    return map[sincePeriod] ?? '1';
  }

  buildSearchUrl(keyword: string, location = 'Deutschland', sincePeriod = 'LAST_24_HOURS'): string {
    const u = new URL('https://www.arbeitsagentur.de/jobsuche/suche');
    u.searchParams.set('was', keyword);
    u.searchParams.set('wo', location);
    u.searchParams.set('angebotsart', '1');
    u.searchParams.set('veroeffentlichtseit', this.sincePeriodToDays(sincePeriod));
    return u.toString();
  }

  async isErrorOrNoResults(): Promise<boolean> {
    // Results list should appear for non-zero results
    const list = this.page.locator('ul[aria-label^="Seite"]');
    return !(await list.isVisible({ timeout: 8000 }).catch(() => false));
  }

  async getJobCards(): Promise<ArbeitsagenturJobCard[]> {
    await this.page.locator('ul[aria-label^="Seite"]').waitFor({ timeout: 15_000 }).catch(() => {});

    return this.page.evaluate(() => {
      const items = document.querySelectorAll('ul[aria-label^="Seite"] > li');
      const results: {
        jobId: string; url: string; title: string; company: string;
        location: string; posted: string; employmentType: string; workplace: string;
      }[] = [];

      items.forEach((item) => {
        const link = item.querySelector('a[href*="jobdetail"]') as HTMLAnchorElement;
        if (!link) return;

        const jobId = link.href.match(/jobdetail\/([^?]+)/)?.[1] ?? '';
        if (!jobId) return;

        const url = `https://www.arbeitsagentur.de/jobsuche/jobdetail/${jobId}`;
        const title = (link.textContent?.trim() ?? '').replace(/^\d+\.\s*Ergebnis:\s*/i, '').trim();
        if (!title) return;

        const cardText = (item as HTMLElement).innerText ?? '';
        const extract = (label: string): string => {
          const re = new RegExp(label + '[:\\s]*\\n([^\\n]+)');
          return cardText.match(re)?.[1]?.trim() ?? '';
        };

        results.push({
          jobId,
          url,
          title,
          company: extract('Arbeitgeber'),
          location: extract('Arbeitsort'),
          posted: extract('Veröffentlichungsdatum'),
          employmentType: extract('Anstellungsart'),
          workplace: /homeoffice möglich/i.test(cardText) ? 'Remote/Hybrid' : '',
        });
      });

      return results;
    });
  }

  async collectCardsForKeyword(
    keyword: string,
    location = 'Deutschland',
    sincePeriod = 'LAST_24_HOURS',
  ): Promise<ArbeitsagenturJobCard[]> {
    try {
      await this.page.goto(this.buildSearchUrl(keyword, location, sincePeriod), {
        waitUntil: 'networkidle',
        timeout: 30_000,
      });
    } catch (err) {
      console.log(`    navigation failed for "${keyword}": ${(err as Error).message}`);
      return [];
    }

    if (await this.isErrorOrNoResults()) {
      console.log(`    no results for "${keyword}" — skipping`);
      return [];
    }

    const cards = await this.getJobCards();
    if (cards.length === 0) {
      const snippet = clean(await this.page.locator('body').innerText().catch(() => '')).slice(0, 300);
      console.log(`    no job cards for "${keyword}" — url=${this.page.url()} body="${snippet}"`);
    }
    return cards;
  }
}

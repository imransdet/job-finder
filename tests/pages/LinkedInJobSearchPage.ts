import { Page } from '@playwright/test';

export interface LinkedInJobCard {
  url: string;
  title: string;
  company: string;
  location: string;
  posted: string;
  salary: string;
  employmentType: string;
  badge: string;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Page Object for LinkedIn's public (no-login) job search.
 * Selectors verified against the live public site (June 2026).
 */
export class LinkedInJobSearchPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Map search-config sincePeriod → LinkedIn's f_TPR seconds param. */
  private sincePeriodToFTPR(sincePeriod: string): string {
    const map: Record<string, string> = {
      LAST_24_HOURS: 'r86400',
      LAST_WEEK: 'r604800',
      LAST_MONTH: 'r2592000',
    };
    return map[sincePeriod] ?? 'r86400';
  }

  buildSearchUrl(keyword: string, location = 'Germany', sincePeriod = 'LAST_24_HOURS'): string {
    const u = new URL('https://www.linkedin.com/jobs/search/');
    u.searchParams.set('keywords', keyword);
    u.searchParams.set('location', location);
    u.searchParams.set('f_TPR', this.sincePeriodToFTPR(sincePeriod));
    u.searchParams.set('position', '1');
    u.searchParams.set('pageNum', '0');
    return u.toString();
  }

  /** Accept LinkedIn's GDPR/cookie consent banner (best-effort). */
  async acceptCookies() {
    await this.page.waitForTimeout(2000);
    const labels = ['Accept all', 'Accept All', 'Accept & continue', 'Agree', 'Allow all cookies'];
    for (const label of labels) {
      const btn = this.page.getByRole('button', { name: label, exact: false });
      if (await btn.count().catch(() => 0)) {
        await btn.first().click({ timeout: 5000 }).catch(() => {});
        await this.page.waitForTimeout(800);
        return;
      }
    }
  }

  async isErrorOrNoResults(): Promise<boolean> {
    const patterns = [
      /no jobs found/i,
      /no matching jobs/i,
      /0 results/i,
      /something went wrong/i,
      /try again later/i,
    ];
    for (const re of patterns) {
      const loc = this.page.getByText(re).first();
      if (await loc.isVisible({ timeout: 500 }).catch(() => false)) return true;
    }
    return false;
  }

  async getJobCards(): Promise<LinkedInJobCard[]> {
    const list = this.page.locator('ul.jobs-search__results-list');
    if (!(await list.isVisible().catch(() => false))) return [];

    const items = list.locator('> li');
    const n = await items.count().catch(() => 0);
    if (n === 0) return [];

    const results: LinkedInJobCard[] = [];
    for (let i = 0; i < n; i++) {
      const item = items.nth(i);

      const link = item.locator('a.base-card__full-link').first();
      const href = await link.getAttribute('href').catch(() => '') ?? '';
      if (!href) continue;

      const title = clean(
        (await item.locator('h3.base-search-card__title').first().innerText().catch(() => '')) ||
        (await link.getAttribute('aria-label').catch(() => '') ?? '')
      );
      const company = clean(await item.locator('h4.base-search-card__subtitle').first().innerText().catch(() => ''));
      const location = clean(await item.locator('span.job-search-card__location').first().innerText().catch(() => ''));

      const postedEl = item.locator('time').first();
      const posted = clean(
        (await postedEl.getAttribute('datetime').catch(() => '')) ||
        (await postedEl.innerText().catch(() => ''))
      );

      const cardText = clean(await item.innerText().catch(() => ''));
      const salary = cardText.match(/€\s?[\d.,]+\s*[–\-]\s*€?\s?[\d.,]+/)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';
      const badge = cardText.match(/\b(Early applicant|Actively hiring|Promoted|New)\b/i)?.[1] ?? '';

      results.push({
        url: href.split('?')[0],
        title,
        company,
        location,
        posted,
        salary,
        employmentType: '',
        badge,
      });
    }
    return results.filter((c) => c.url && c.title);
  }

  /**
   * Navigate directly to a keyword's search results and return job cards.
   * Returns [] (instead of throwing) on navigation errors, no-results, or error pages.
   */
  async collectCardsForKeyword(
    keyword: string,
    location = 'Germany',
    sincePeriod = 'LAST_24_HOURS',
  ): Promise<LinkedInJobCard[]> {
    try {
      await this.page.goto(this.buildSearchUrl(keyword, location, sincePeriod), {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
    } catch (err) {
      console.log(`    navigation failed for "${keyword}": ${(err as Error).message}`);
      return [];
    }

    await this.page.waitForTimeout(2000);

    if (await this.isErrorOrNoResults()) {
      console.log(`    no results for "${keyword}" — skipping`);
      return [];
    }

    return this.getJobCards();
  }
}

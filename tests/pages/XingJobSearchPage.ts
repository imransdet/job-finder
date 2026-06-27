import { Page, Locator, FrameLocator, expect } from '@playwright/test';

export interface JobCard {
  url: string;
  title: string;
  company: string;
  salary: string;
  employmentType: string;
  posted: string;
  badge: string;
}

/**
 * Page Object for Xing's job search flow.
 * Selectors were verified against the live site (May 2026).
 */
export class XingJobSearchPage {
  readonly page: Page;
  readonly fakeSearchField: Locator;   // the search box on the landing page
  readonly keywordField: Locator;      // keyword textarea on the search page
  readonly locationField: Locator;     // location input
  readonly searchButton: Locator;      // the round right-arrow submit button
  readonly jobCountHeading: Locator;   // e.g. "99+ jobs found"
  readonly locationChip: Locator;      // "Location: Germany" filter chip
  readonly past24HoursFilter: Locator; // "Past 24 hours" date-posted filter
  readonly jobResults: Locator;        // individual job cards

  constructor(page: Page) {
    this.page = page;
    this.fakeSearchField = page.getByTestId('search-bar-fake-input');
    this.keywordField = page.getByTestId('cs-search-bar-textarea');
    this.locationField = page.getByPlaceholder('Location');
    this.searchButton = page.locator('button[type="submit"]');
    this.jobCountHeading = page.getByText(/\d[\d.,]*\+?\s+jobs found/i);
    this.locationChip = page.getByRole('button', { name: /Delete Location:\s*Germany/i });
    this.past24HoursFilter = page.getByRole('button', { name: 'Past 24 hours', exact: true });
    this.jobResults = page.getByTestId('job-search-result');
  }

  async goto() {
    await this.page.goto('https://www.xing.com/', { waitUntil: 'domcontentloaded' });
  }

  /** Accept the Usercentrics cookie consent banner (rendered in the main doc/iframe). */
  async acceptCookies() {
    const labels = ['Accept all', 'Accept All', 'Alle akzeptieren', 'Akzeptieren'];
    // Give the CMP a moment to render.
    await this.page.waitForTimeout(1500);
    for (const frame of this.page.frames()) {
      for (const label of labels) {
        const btn = frame.getByRole('button', { name: label, exact: false });
        if (await btn.count().catch(() => 0)) {
          await btn.first().click({ timeout: 5000 }).catch(() => {});
          await this.page.waitForTimeout(800);
          return;
        }
      }
    }
  }

  async openSearch() {
    await expect(this.fakeSearchField).toBeVisible();
    await this.fakeSearchField.click();
    await expect(this.keywordField).toBeVisible();
  }

  async enterKeyword(keyword: string) {
    await this.keywordField.click();
    await this.keywordField.fill(keyword);
    // Close the suggestion dropdown that overlays the form.
    await this.page.keyboard.press('Escape');
  }

  async enterLocation(location: string) {
    await expect(this.locationField).toBeVisible();
    await this.locationField.click();
    await this.locationField.fill(location);
    // Let any autocomplete settle; the free-typed value is applied on submit.
    await this.page.waitForTimeout(1500);
  }

  async submitSearch() {
    await expect(this.searchButton).toBeVisible();
    await this.searchButton.click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  /**
   * A feedback / survey pop-up can appear after searching. Best-effort dismissal:
   * tries common close affordances in the main page and in any survey iframe.
   */
  async dismissFeedbackPopup() {
    await this.page.waitForTimeout(1500);
    const closeNames = ['Close', 'No thanks', 'Not now', 'Dismiss', 'Schließen', '×'];

    const tryClose = async (scope: Page | FrameLocator) => {
      // Buttons by accessible name.
      for (const name of closeNames) {
        const btn = scope.getByRole('button', { name, exact: false });
        if (await btn.count().catch(() => 0)) {
          if (await btn.first().isVisible().catch(() => false)) {
            await btn.first().click({ timeout: 3000 }).catch(() => {});
            return true;
          }
        }
      }
      // Generic close icons.
      const icon = scope.locator(
        '[aria-label*="close" i], [data-testid*="close" i], button[title*="close" i]'
      );
      if (await icon.count().catch(() => 0)) {
        if (await icon.first().isVisible().catch(() => false)) {
          await icon.first().click({ timeout: 3000 }).catch(() => {});
          return true;
        }
      }
      return false;
    };

    // Main document first.
    if (await tryClose(this.page)) return;
    // Then any iframes (feedback widgets are often embedded).
    for (const frame of this.page.frames()) {
      const fl = this.page.frameLocator(`iframe[src="${frame.url()}"]`);
      if (await tryClose(fl).catch(() => false)) return;
    }
    // Fallback: Escape often closes lightweight modals.
    await this.page.keyboard.press('Escape').catch(() => {});
  }

  /** Apply the "Past 24 hours" date-posted filter and wait for results to refresh. */
  async filterPast24Hours() {
    await expect(this.past24HoursFilter).toBeVisible();
    await this.past24HoursFilter.scrollIntoViewIfNeeded();

    // Capture the first result before filtering so we can detect the refresh,
    // instead of relying on networkidle (Xing polls analytics continuously).
    const before = await this.jobResults.first().innerText().catch(() => '');
    await this.past24HoursFilter.click();

    // Wait until the results list changes (filtered set rendered).
    await expect
      .poll(async () => this.jobResults.first().innerText().catch(() => ''), { timeout: 20_000 })
      .not.toBe(before);
    await this.page.waitForTimeout(500);
  }

  /** Build a direct results URL for a keyword (location + optional recency filter). */
  buildSearchUrl(keyword: string, location = 'Germany', sincePeriod = 'LAST_24_HOURS'): string {
    const u = new URL('https://www.xing.com/jobs/search/ki');
    u.searchParams.set('keywords', keyword);
    u.searchParams.set('location', location);
    if (sincePeriod) u.searchParams.set('sincePeriod', sincePeriod);
    return u.toString();
  }

  /**
   * Navigate directly to a keyword's results for the given location/recency and
   * return the job cards. Tolerates the cases that would otherwise fail the
   * whole run — no results, Xing's "Something went wrong" error page, and
   * navigation/network errors all resolve to []. The caller can then move on
   * to the next search key without aborting.
   */
  async collectCardsForKeyword(
    keyword: string,
    location = 'Germany',
    sincePeriod = 'LAST_24_HOURS'
  ): Promise<JobCard[]> {
    try {
      await this.page.goto(this.buildSearchUrl(keyword, location, sincePeriod), {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
    } catch (err) {
      console.log(`    navigation failed for "${keyword}": ${(err as Error).message}`);
      return [];
    }
    // Wait for either job cards or the count heading to settle.
    await Promise.race([
      this.jobResults.first().waitFor({ timeout: 15_000 }).catch(() => {}),
      this.jobCountHeading.first().waitFor({ timeout: 15_000 }).catch(() => {}),
    ]);
    await this.page.waitForTimeout(700);
    if (await this.isErrorPage()) {
      console.log(`    error page shown for "${keyword}" — skipping`);
      return [];
    }
    if (!(await this.jobResults.first().isVisible().catch(() => false))) {
      // Unrecognized empty state (e.g. a bot-check page) — log enough to
      // diagnose without needing the (disabled) screenshot/trace artifacts.
      const title = await this.page.title().catch(() => '');
      const snippet = (await this.page.locator('body').innerText().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
      console.log(`    no job results for "${keyword}" — url=${this.page.url()} title="${title}" body="${snippet}"`);
      return [];
    }
    return this.getJobCards();
  }

  /**
   * Detect Xing's generic error / no-results screens so we can skip the
   * search key without throwing. Matches the most common phrasings in EN/DE.
   */
  async isErrorPage(): Promise<boolean> {
    const patterns: RegExp[] = [
      /something went wrong/i,
      /etwas ist schiefgelaufen/i,
      /no (jobs?|results?) found/i,
      /keine (jobs|treffer|ergebnisse)/i,
      /try again/i,
      /erneut versuchen/i,
    ];
    for (const re of patterns) {
      const loc = this.page.getByText(re).first();
      if (await loc.isVisible({ timeout: 500 }).catch(() => false)) return true;
    }
    return false;
  }

  /**
   * Collect card-level data for every job in the results list. The listing card
   * carries the clean salary range, employment type, posted date and badge,
   * which are cleaner here than on the detail page.
   */
  async getJobCards(): Promise<JobCard[]> {
    if (!(await this.jobResults.first().isVisible().catch(() => false))) return [];
    const n = await this.jobResults.count();
    const cards: JobCard[] = [];
    for (let i = 0; i < n; i++) {
      const card = this.jobResults.nth(i);
      const link = card.locator('a[href^="/jobs/"]').first();
      const href = await link.getAttribute('href').catch(() => '');
      const cardTitle = (await link.getAttribute('aria-label').catch(() => '')) || '';
      const cardCompany = (await card.locator('img[title]').first().getAttribute('title').catch(() => '')) || '';
      const text = (await card.innerText().catch(() => '')).replace(/ /g, ' ');
      cards.push({
        url: href ? (href.startsWith('http') ? href : `https://www.xing.com${href}`) : '',
        title: cardTitle.replace(/\.\s*Click to open.*$/i, '').trim(),
        company: cardCompany.trim(),
        salary: text.match(/€\s?[\d.,]+\s*[–-]\s*€?\s?[\d.,]+/)?.[0]?.replace(/\s+/g, ' ').trim() ?? '',
        employmentType:
          text.match(/\b(Full-time|Part-time|Working Student|Internship|Contract|Temporary|Freelance|Mini job)\b/i)?.[1] ?? '',
        posted:
          text.match(/(\d+\s+(?:hour|day|week|month)s?\s+ago|Yesterday|Today)/i)?.[1] ?? '',
        badge: text.match(/(Be an early applicant|Urgently hiring|New)/i)?.[1] ?? '',
      });
    }
    return cards.filter((c) => c.url);
  }

  /** Returns the raw count text, e.g. "99+ jobs found". */
  async getJobCountText(): Promise<string> {
    await expect(this.jobCountHeading).toBeVisible();
    return (await this.jobCountHeading.first().innerText()).trim();
  }

  /** Parses the leading number out of the count heading ("99+ jobs found" -> 99). */
  async getJobCount(): Promise<number> {
    const text = await this.getJobCountText();
    const match = text.match(/([\d.,]+)/);
    return match ? parseInt(match[1].replace(/[.,]/g, ''), 10) : 0;
  }
}

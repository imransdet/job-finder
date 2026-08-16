import { Page } from '@playwright/test';

export interface GlassdoorJobCard {
  jobId: string;
  url: string;
  title: string;
  company: string;
  location: string;
  posted: string;
  salary: string;
  workplace: string;
  employmentType: string;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Page Object for Glassdoor Germany job search (glassdoor.de).
 * No bot protection — accessible from headless Chromium and CI runners.
 * Selectors verified against www.glassdoor.de (July 2026).
 */
export class GlassdoorJobSearchPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private sincePeriodToFromAge(sincePeriod: string): string {
    const map: Record<string, string> = {
      LAST_24_HOURS: '1',
      LAST_WEEK: '7',
      LAST_MONTH: '30',
    };
    return map[sincePeriod] ?? '1';
  }

  buildSearchUrl(keyword: string, location = 'Deutschland', sincePeriod = 'LAST_24_HOURS'): string {
    const u = new URL('https://www.glassdoor.de/Job/jobs.htm');
    u.searchParams.set('sc.keyword', keyword);
    u.searchParams.set('locT', 'N');
    u.searchParams.set('locId', '96'); // Germany nation ID
    u.searchParams.set('locKeyword', location);
    u.searchParams.set('fromAge', this.sincePeriodToFromAge(sincePeriod));
    return u.toString();
  }

  /** Best-effort cookie consent acceptance. */
  async acceptCookies() {
    await this.page.waitForTimeout(1500);
    const labels = ['Accept all', 'Accept All', 'Alle akzeptieren', 'Akzeptieren', 'Accept'];
    for (const label of labels) {
      const btn = this.page.getByRole('button', { name: label, exact: false });
      if (await btn.count().catch(() => 0)) {
        if (await btn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.first().click({ timeout: 5000 }).catch(() => {});
          await this.page.waitForTimeout(800);
          return;
        }
      }
    }
  }

  /**
   * Click the "Gepostet" date filter and select the matching option.
   * Glassdoor drops the `fromAge` URL param on redirect, so we apply it via UI.
   */
  async applyDateFilter(sincePeriod = 'LAST_24_HOURS') {
    const optionMap: Record<string, RegExp> = {
      LAST_24_HOURS: /letzte 24 stunden|last 24 hours/i,
      LAST_WEEK: /letzte 7 tage|last week/i,
      LAST_MONTH: /letzter monat|last month/i,
    };
    const optionRe = optionMap[sincePeriod];
    if (!optionRe) return;

    const gepostetBtn = this.page.getByRole('button', { name: /^Gepostet$/i });
    if (!(await gepostetBtn.count().catch(() => 0))) return;

    await gepostetBtn.first().click().catch(() => {});
    await this.page.waitForTimeout(800);

    const option = this.page.getByText(optionRe).first();
    if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
      await option.click().catch(() => {});
      await this.page.waitForTimeout(1500);
    } else {
      // Close the dropdown if option wasn't found
      await this.page.keyboard.press('Escape').catch(() => {});
    }
  }

  async isErrorOrNoResults(): Promise<boolean> {
    const patterns = [/keine (jobs|treffer|ergebnisse)/i, /0 (jobs|ergebnisse)/i, /no jobs found/i];
    for (const re of patterns) {
      if (await this.page.getByText(re).first().isVisible({ timeout: 500 }).catch(() => false)) return true;
    }
    return false;
  }

  async getJobCards(): Promise<GlassdoorJobCard[]> {
    const list = this.page.locator('ul[aria-label="Jobs List"]').first();
    await list.waitFor({ timeout: 15_000 }).catch(() => {});
    if (!(await list.isVisible().catch(() => false))) return [];

    const items = list.locator('> li');
    const n = await items.count().catch(() => 0);
    if (n === 0) return [];

    const results: GlassdoorJobCard[] = [];
    for (let i = 0; i < n; i++) {
      const item = items.nth(i);

      // Title and URL from the direct job-listing link (not the partner redirect link)
      const titleLink = item.locator('a[href*="/job-listing/"]').first();
      const href = await titleLink.getAttribute('href').catch(() => '') ?? '';
      if (!href) continue;
      const url = href.startsWith('http') ? href : `https://www.glassdoor.de${href}`;
      const title = clean(await titleLink.textContent().catch(() => ''));
      if (!title) continue;

      // Job ID from the ?jl= query param (stable, not the slug)
      const jobId = url.match(/[?&]jl=(\d+)/)?.[1] ?? url;

      // Company from the logo img alt: "Logo von {company}"
      const altText = await item.locator('img[alt^="Logo von"]').first()
        .getAttribute('alt').catch(() => '') ?? '';
      const company = altText.replace(/^Logo von\s*/i, '').trim();

      // Posted date text ("30T+", "13T", "24Std") visible on the card
      const cardText = await item.innerText().catch(() => '');
      const posted = cardText.match(/\b(\d+\s*(?:Std|T\+?|T))\b/)?.[0]?.trim() ?? '';

      // Salary if shown on card
      const salary =
        cardText.match(/€\s?[\d.,]+\s*[–\-]\s*€?\s?[\d.,]+/)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';

      // Workplace from card badges (Glassdoor shows "Remote", "Hybrid", "Vor Ort")
      const workplace = /\bremote\b/i.test(cardText)
        ? 'Remote'
        : /\bhybrid\b/i.test(cardText)
        ? 'Hybrid'
        : '';

      // Employment type if shown on card
      const employmentType =
        cardText.match(/\b(Vollzeit|Teilzeit|Freelance|Praktikum|Werkstudent|Full-time|Part-time|Contract)\b/i)?.[1] ?? '';

      // Location: first short line that looks like a city (not the title, not the company)
      const lines = cardText.split('\n').map(l => l.trim()).filter(Boolean);
      const location = lines.find(l =>
        l !== title && l !== company && l.length > 2 && l.length < 60 &&
        !/^\d/.test(l) && !/^(Std|T\+?|T|€|Remote|Hybrid|Vor Ort|Vollzeit|Teilzeit)/i.test(l) &&
        !/logo/i.test(l)
      ) ?? '';

      results.push({ jobId, url, title, company, location, posted, salary, workplace, employmentType });
    }
    return results.filter((c) => c.jobId && c.title);
  }

  async collectCardsForKeyword(
    keyword: string,
    location = 'Deutschland',
    sincePeriod = 'LAST_24_HOURS',
  ): Promise<GlassdoorJobCard[]> {
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

    await this.applyDateFilter(sincePeriod);

    const cards = await this.getJobCards();
    if (cards.length === 0) {
      const title = await this.page.title().catch(() => '');
      const snippet = (await this.page.locator('body').innerText().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
      console.log(`    no job results for "${keyword}" — url=${this.page.url()} title="${title}" body="${snippet}"`);
    }
    return cards;
  }
}

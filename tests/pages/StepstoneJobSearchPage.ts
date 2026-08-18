import { Page } from '@playwright/test';

export interface StepstoneJobCard {
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
 * Page Object for Stepstone Germany job search (stepstone.de).
 * Card-only scraping — no detail page navigation.
 * Selectors verified against www.stepstone.de (August 2026).
 */
export class StepstoneJobSearchPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private ageParam(sincePeriod: string): string {
    const map: Record<string, string> = { LAST_24_HOURS: '1', LAST_WEEK: '7', LAST_MONTH: '30' };
    return map[sincePeriod] ?? '1';
  }

  buildSearchUrl(keyword: string, location = 'Deutschland', sincePeriod = 'LAST_24_HOURS'): string {
    const slug = keyword.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const locSlug = location.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const ageMap: Record<string, string> = { LAST_24_HOURS: '1', LAST_WEEK: '7', LAST_MONTH: '30' };
    const u = new URL(`https://www.stepstone.de/jobs/${slug}/in-${locSlug}`);
    u.searchParams.set('sort', '2');
    u.searchParams.set('age', ageMap[sincePeriod] ?? '1');
    return u.toString();
  }

  /**
   * Navigate to the Stepstone homepage first to acquire the Akamai session cookie,
   * then accept cookies. Subsequent search navigations within the same session are
   * less likely to hit the Access Denied bot-protection wall.
   */
  async warmUp() {
    await this.page.goto('https://www.stepstone.de/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await this.page.waitForTimeout(2000);
    await this.acceptCookies();
    await this.page.waitForTimeout(1000);
  }

  async acceptCookies() {
    await this.page.waitForTimeout(1500);
    const labels = ['Alle akzeptieren', 'Accept all', 'Accept All', 'Akzeptieren', 'Accept'];
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

  async isBlocked(): Promise<boolean> {
    const title = await this.page.title().catch(() => '');
    return /just a moment|challenge|access denied|are you human/i.test(title);
  }

  async isErrorOrNoResults(): Promise<boolean> {
    if (await this.isBlocked()) return true;
    const patterns = [/keine (jobs|treffer|ergebnisse)/i, /0 (jobs|ergebnisse)/i, /no jobs found/i];
    for (const re of patterns) {
      if (await this.page.getByText(re).first().isVisible({ timeout: 500 }).catch(() => false)) return true;
    }
    return false;
  }

  async getJobCards(): Promise<StepstoneJobCard[]> {
    // Stepstone uses data-at attributes on job cards.
    await this.page.waitForSelector('[data-at="job-item"]', { timeout: 15_000 }).catch(() => {});

    const cards = this.page.locator('[data-at="job-item"]');
    const n = await cards.count().catch(() => 0);
    if (n === 0) return [];

    const results: StepstoneJobCard[] = [];
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);

      const titleEl = card.locator('[data-at="job-item-title"]').first();
      const href = await titleEl.getAttribute('href').catch(() => '') ?? '';
      if (!href) continue;

      const url = href.startsWith('http') ? href : `https://www.stepstone.de${href}`;
      const title = clean(await titleEl.textContent().catch(() => ''));
      if (!title) continue;

      // Job ID: numeric part before -inline.html or end of slug.
      const jobId = url.match(/--(\d+)(?:-inline)?(?:\.html|$)/)?.[1] ?? url;

      const company = clean(
        await card.locator('[data-at="job-item-company-name"]').first().textContent().catch(() => '') ||
        await card.locator('[data-at="company-logo"] img').first().getAttribute('alt').catch(() => '') ||
        '',
      );
      const location = clean(
        await card.locator('[data-at="job-item-location"]').first().textContent().catch(() => ''),
      );

      const cardText = await card.innerText().catch(() => '');

      const posted =
        cardText.match(/\b(\d+)\s*(Tag|Stunde|day|hour|week|Woche)\w*\s*(vor|ago)/i)?.[0]?.trim() ?? '';
      const salary =
        cardText.match(/€\s?[\d.,]+\s*[–\-]\s*€?\s?[\d.,]+/)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';
      const workplace = /\bremote\b/i.test(cardText) ? 'Remote' : /\bhybrid\b/i.test(cardText) ? 'Hybrid' : '';
      const employmentType =
        cardText.match(/\b(Vollzeit|Teilzeit|Freelance|Praktikum|Werkstudent|Full-time|Part-time|Contract)\b/i)?.[1] ?? '';

      results.push({ jobId, url, title, company, location, posted, salary, workplace, employmentType });
    }
    return results.filter((c) => c.jobId && c.title);
  }

  async collectCardsForKeyword(
    keyword: string,
    location = 'Deutschland',
    sincePeriod = 'LAST_24_HOURS',
  ): Promise<StepstoneJobCard[]> {
    const url = this.buildSearchUrl(keyword, location, sincePeriod);
    try {
      // Navigate via JS so the browser sends a stepstone.de Referer (looks like an in-site link).
      await this.page.evaluate((href: string) => { window.location.href = href; }, url);
      await this.page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
    } catch (err) {
      console.log(`    navigation failed for "${keyword}": ${(err as Error).message}`);
      return [];
    }

    await this.page.waitForTimeout(2000);

    if (await this.isErrorOrNoResults()) {
      const title = await this.page.title().catch(() => '');
      const snippet = (await this.page.locator('body').innerText().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
      console.log(`    no results for "${keyword}" — title="${title}" body="${snippet}"`);
      return [];
    }

    const cards = await this.getJobCards();
    if (cards.length === 0) {
      const title = await this.page.title().catch(() => '');
      const snippet = (await this.page.locator('body').innerText().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
      console.log(`    no job results for "${keyword}" — url=${this.page.url()} title="${title}" body="${snippet}"`);
    }
    return cards;
  }
}

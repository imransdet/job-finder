import { Page } from '@playwright/test';

export interface BAJobCard {
  jobId: string;
  url: string;
  title: string;
  company: string;
  posted: string;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Page Object for Germany's Federal Employment Agency job search (Arbeitsagentur).
 * No bot protection — accessible from headless Chromium and CI runners.
 * Selectors verified against www.arbeitsagentur.de/jobsuche (July 2026).
 */
export class ArbeitsagenturJobSearchPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  buildSearchUrl(keyword: string, location = 'Deutschland'): string {
    const u = new URL('https://www.arbeitsagentur.de/jobsuche/suche');
    u.searchParams.set('angebotsart', '1'); // regular jobs (not apprenticeships)
    u.searchParams.set('was', keyword);
    u.searchParams.set('wo', location);
    u.searchParams.set('sort', 'Aktualitaet'); // newest first
    return u.toString();
  }

  /** Accept the BA cookie consent banner. */
  async acceptCookies() {
    await this.page.waitForTimeout(2000);
    const btn = this.page.getByTestId('bahf-cookie-disclaimer-btn-alle');
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      await this.page.waitForTimeout(800);
    }
  }

  async isErrorOrNoResults(): Promise<boolean> {
    const patterns = [/keine (stellen|ergebnisse|treffer)/i, /0 (jobs|ergebnisse)/i];
    for (const re of patterns) {
      if (await this.page.getByText(re).first().isVisible({ timeout: 500 }).catch(() => false)) return true;
    }
    return false;
  }

  async getJobCards(): Promise<BAJobCard[]> {
    // Wait for the results list to render.
    const list = this.page.locator('ul[aria-label*="Ergebnisliste"]').first();
    await list.waitFor({ timeout: 15_000 }).catch(() => {});
    if (!(await list.isVisible().catch(() => false))) return [];

    const items = list.locator('> li');
    const n = await items.count().catch(() => 0);
    if (n === 0) return [];

    const results: BAJobCard[] = [];
    for (let i = 0; i < n; i++) {
      const item = items.nth(i);

      // Title is in h3 text like "3. Software QA-Engineer (w/m/d)"; strip "N. " prefix.
      const h3Text = clean(await item.locator('h3').nth(1).innerText().catch(() => ''));
      const title = h3Text.replace(/^\d+\.\s*/, '').trim();
      if (!title) continue;

      // Company is in h4 text like "Arbeitgeber: Scopevisio"; strip prefix.
      const h4Text = clean(await item.locator('h4').first().innerText().catch(() => ''));
      const company = h4Text.replace(/^Arbeitgeber:\s*/i, '').trim();

      // Job ID from the "Aktionen" button — accessible name is text content, not aria-label.
      const actionBtn = item.getByRole('button', { name: /Aktionen für das Stellenangebot/i }).first();
      const actionText = clean(
        (await actionBtn.getAttribute('aria-label').catch(() => '')) ||
        (await actionBtn.innerText().catch(() => ''))
      );
      const jobId = actionText.replace(/^Aktionen für das Stellenangebot\s*/i, '').trim();
      if (!jobId) continue;

      // Posted date from "Veröffentlichungsdatum: DD.MM.YYYY"
      const dateEl = item.locator('[aria-label*="Veröffentlichungsdatum"]').first();
      const dateLabel = clean(await dateEl.getAttribute('aria-label').catch(() => ''));
      const posted = dateLabel.replace(/^Veröffentlichungsdatum:\s*/i, '').trim();

      results.push({
        jobId,
        url: `https://www.arbeitsagentur.de/jobsuche/jobdetail/${jobId}`,
        title,
        company,
        posted,
      });
    }
    return results.filter((c) => c.jobId && c.title);
  }

  async collectCardsForKeyword(keyword: string, location = 'Deutschland'): Promise<BAJobCard[]> {
    try {
      await this.page.goto(this.buildSearchUrl(keyword, location), {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
    } catch (err) {
      console.log(`    navigation failed for "${keyword}": ${(err as Error).message}`);
      return [];
    }

    await this.page.waitForTimeout(1500);

    if (await this.isErrorOrNoResults()) {
      console.log(`    no results for "${keyword}" — skipping`);
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

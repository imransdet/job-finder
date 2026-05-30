import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { XingJobSearchPage, JobCard } from './pages/XingJobSearchPage';
import { scrapeJobDetail } from '../lib/scrape';
import { writeJobsToSheet, JobRow } from '../lib/sheets';

// Search keys live in search-config.json so they can be edited without touching code.
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(resolve(__dirname, '../search-config.json'), 'utf8')) as {
  location: string;
  sincePeriod: string;
  job_titles: string[];
};
const JOB_TITLES: string[] = CONFIG.job_titles;
const LOCATION = CONFIG.location ?? 'Germany';
const SINCE_PERIOD = CONFIG.sincePeriod ?? 'LAST_24_HOURS';

/** Unique job id = trailing number in the URL (slug differs, id is stable). */
function jobId(url: string): string {
  return url.match(/-(\d+)(?:[/?#]|$)/)?.[1] ?? url;
}

/**
 * Dedupe key for a job. Recruiters often repost the same role with different
 * job IDs, so we key on normalized title + company (collapsing reposts). Falls
 * back to the job ID when the card title is missing.
 */
function dedupeKey(card: JobCard): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const title = norm(card.title);
  return title ? `${title}::${norm(card.company)}` : jobId(card.url);
}

/**
 * Xing's AI search pads sparse queries with loosely-related / "similar" jobs
 * (SAP, Java dev, machine operator, etc.). Keep only genuine QA/testing roles
 * by matching the job title against QA/test vocabulary (English + German).
 */
const QA_RELEVANCE =
  /\b(qa|sdet|tester|testing|test\s*automation|testautomat\w*|softwaretest\w*|software\s*test|quality\s*assurance|qualit[äa]tssicherung|test\s*engineer|test\s*analyst|testanalyst|testingenieur|quality\s*engineer|automation\s*test)\b/i;

function isRelevant(title: string): boolean {
  return QA_RELEVANCE.test(title);
}

test.describe('Xing multi-title job collection', () => {
  test.setTimeout(30 * 60_000); // up to 30 min: 26 searches + scraping all unique jobs

  test('search all QA titles (Past 24h, Germany), dedupe, write to Google Sheet', async ({ page }) => {
    const xing = new XingJobSearchPage(page);

    // Dedupe store: signature -> { card, terms that found it }
    const unique = new Map<string, { card: JobCard; terms: Set<string> }>();

    // Dedupe the search keys themselves (case-insensitive), in case the JSON
    // ends up with repeats after edits.
    const seenTitle = new Set<string>();
    const dedupedTitles = JOB_TITLES.filter((t) => {
      const k = t.toLowerCase().trim();
      if (!k || seenTitle.has(k)) return false;
      seenTitle.add(k);
      return true;
    });
    if (dedupedTitles.length !== JOB_TITLES.length) {
      console.log(`Removed ${JOB_TITLES.length - dedupedTitles.length} duplicate search key(s) from config.`);
    }

    // Optional smoke-test knob: LIMIT=3 only searches the first 3 titles.
    const titles = process.env.LIMIT ? dedupedTitles.slice(0, Number(process.env.LIMIT)) : dedupedTitles;

    await test.step('Collect job cards for all titles', async () => {
      // First navigation also triggers the cookie consent; accept it once.
      await page.goto(xing.buildSearchUrl(titles[0], LOCATION, SINCE_PERIOD), { waitUntil: 'domcontentloaded' });
      await xing.acceptCookies();

      let totalSeen = 0;
      let totalRelevant = 0;
      for (const [i, title] of titles.entries()) {
        const cards = await xing.collectCardsForKeyword(title, LOCATION, SINCE_PERIOD);
        totalSeen += cards.length;
        const relevant = cards.filter((c) => isRelevant(c.title));
        totalRelevant += relevant.length;
        for (const card of relevant) {
          const key = dedupeKey(card);
          const entry = unique.get(key);
          if (entry) {
            entry.terms.add(title);
          } else {
            unique.set(key, { card, terms: new Set([title]) });
          }
        }
        console.log(
          `[${i + 1}/${titles.length}] "${title}": ${cards.length} cards, ${relevant.length} QA-relevant | unique so far: ${unique.size}`
        );
      }
      console.log(`\nCards seen: ${totalSeen}; QA-relevant: ${totalRelevant}; unique after dedupe: ${unique.size}`);
      expect(unique.size).toBeGreaterThan(0);
    });

    const jobs: JobRow[] = [];
    await test.step('View each unique job and scrape its data', async () => {
      const entries = [...unique.values()];
      // Final safety dedupe on the scraped data: skip if the same job id or the
      // same title+company has already been recorded.
      const seenId = new Set<string>();
      const seenSig = new Set<string>();
      for (const [i, { card, terms }] of entries.entries()) {
        try {
          const job = await scrapeJobDetail(page, card);
          job.foundVia = [...terms].join(', ');
          const id = jobId(job.url);
          const sig = `${job.title.toLowerCase().trim()}::${job.company.toLowerCase().trim()}`;
          if (seenId.has(id) || seenSig.has(sig)) {
            console.log(`[${i + 1}/${entries.length}] DUPLICATE skipped: ${job.title} — ${job.company}`);
            continue;
          }
          seenId.add(id);
          seenSig.add(sig);
          jobs.push(job);
          console.log(`[${i + 1}/${entries.length}] ${job.title} — ${job.company} — ${job.location}`);
        } catch (err) {
          console.log(`[${i + 1}/${entries.length}] FAILED ${card.url}: ${(err as Error).message}`);
        }
      }
      expect(jobs.length).toBeGreaterThan(0);
    });

    await test.step('Write the deduped jobs to the Google Sheet', async () => {
      if (process.env.LIMIT) {
        console.log(`LIMIT set — skipping sheet write. Would have written ${jobs.length} jobs.`);
        jobs.forEach((j) => console.log(`  • ${j.title} [${j.foundVia}]`));
        return;
      }
      const result = await writeJobsToSheet(jobs);
      console.log(`Wrote ${result.rows} unique jobs to "${result.sheetName}"`);
      expect(result.rows).toBe(jobs.length);
    });
  });
});

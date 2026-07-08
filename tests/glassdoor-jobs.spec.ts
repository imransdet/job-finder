import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { GlassdoorJobSearchPage, GlassdoorJobCard } from './pages/GlassdoorJobSearchPage';
import { scrapeGlassdoorDetail } from '../lib/scrape-glassdoor';
import { initSheet, appendJobs, writeJobsToSheet, JobRow } from '../lib/sheets';
import { scoreJob, loadProfile } from '../lib/match';
import { pushApplied, trackerEnabled } from '../lib/tracker';

// Route Google Sheets writes to the Glassdoor tab instead of the Xing tab.
process.env.GOOGLE_SHEET_NAME = process.env.GOOGLE_SHEET_NAME_GD ?? 'gd-raw-data';

// Use 'Glassdoor' as the platform name for the Job Tracker push.
process.env.JOB_TRACKER_PLATFORM = 'Glassdoor';

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 0);
const TOP_N = Number(process.env.TOP_N ?? 10);

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(resolve(__dirname, '../search-config.json'), 'utf8')) as {
  location: string;
  sincePeriod: string;
  job_titles: string[];
};
const JOB_TITLES: string[] = CONFIG.job_titles;
const LOCATION = process.env.SEARCH_LOCATION || CONFIG.location || 'Deutschland';
const SINCE_PERIOD = process.env.SEARCH_SINCE_PERIOD || CONFIG.sincePeriod || 'LAST_24_HOURS';

function jobId(url: string): string {
  return url.match(/[?&]jl=(\d+)/)?.[1] ?? url;
}

const GENDER_RE =
  /\b(m\/w\/d|m\/f\/d|w\/m\/d|d\/f\/m|m\/f\/x|m\/w\/x|w\/m\/x|f\/m\/d|f\/m\/x|m\/w\/d\/x|all genders?|gn)\b/gi;
const STOPWORDS = new Set([
  'im', 'in', 'der', 'die', 'das', 'den', 'the', 'for', 'fuer', 'für', 'an', 'at',
  'als', 'a', 'und', 'and', 'mit', 'with', 'von', 'of', 'zur', 'zum', 'bei', 'm', 'w', 'd', 'f', 'x',
  'remote', 'hybrid', 'onsite', 'site', 'home', 'office', 'homeoffice', 'telearbeit',
]);

function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d+\s*%/g, ' ')
    .replace(GENDER_RE, ' ')
    .replace(/[^a-z0-9äöüß]+/gi, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t))
    .sort()
    .join(' ')
    .trim();
}

function dedupeKey(card: GlassdoorJobCard): string {
  const company = card.company.toLowerCase().replace(/\s+/g, ' ').trim();
  const title = normTitle(card.title);
  return title ? `${title}::${company}` : jobId(card.url);
}

const QA_RELEVANCE =
  /\b(qa|sdet|tester|testing|test\s*automation|testautomat\w*|softwaretest\w*|software\s*test|quality\s*assurance|qualit[äa]tssicherung|test\s*engineer|test\s*analyst|testanalyst|testingenieur|quality\s*engineer|automation\s*test)\b/i;

function isRelevant(title: string): boolean {
  return QA_RELEVANCE.test(title);
}

test.describe('Glassdoor multi-title job collection', () => {
  test.setTimeout(60 * 60_000);

  test('per-search scrape + profile match (Z.AI), write matches, keep top N', async ({ page }) => {
    // Remove automation signal that triggers Cloudflare/bot-detection challenges.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const glassdoor = new GlassdoorJobSearchPage(page);
    const isSmoke = !!process.env.LIMIT;
    const scoringEnabled = !!process.env.ZAI_API_KEY;
    if (!isSmoke && !scoringEnabled) {
      throw new Error('ZAI_API_KEY is required for scoring. Set it in .env (local) or as a GitHub secret (CI).');
    }
    if (scoringEnabled) loadProfile();

    const seenTitle = new Set<string>();
    const dedupedTitles = JOB_TITLES.filter((t) => {
      const k = t.toLowerCase().trim();
      if (!k || seenTitle.has(k)) return false;
      seenTitle.add(k);
      return true;
    });

    const titles = process.env.LIMIT ? dedupedTitles.slice(0, Number(process.env.LIMIT)) : dedupedTitles;

    if (!isSmoke) await initSheet();

    // First navigation also triggers cookie consent; accept once.
    await page.goto(glassdoor.buildSearchUrl(titles[0], LOCATION, SINCE_PERIOD), {
      waitUntil: 'domcontentloaded',
    });
    await glassdoor.acceptCookies();

    const seen = new Set<string>();
    const matched: JobRow[] = [];
    const failedTitles: string[] = [];

    for (const [i, title] of titles.entries()) {
      await test.step(`Search "${title}" → scrape → score`, async () => {
        const titleMatched: JobRow[] = [];
        try {
          const cards = await glassdoor.collectCardsForKeyword(title, LOCATION, SINCE_PERIOD);
          const relevant = cards.filter((c) => isRelevant(c.title));
          let newCount = 0;

          for (const card of relevant) {
            const key = dedupeKey(card);
            if (seen.has(key)) continue;
            seen.add(key);

            let job: JobRow;
            try {
              job = await scrapeGlassdoorDetail(page, card);
            } catch (err) {
              console.log(`    scrape failed: ${card.url} — ${(err as Error).message}`);
              continue;
            }
            job.foundVia = title;
            newCount++;

            if (scoringEnabled) {
              const m = await scoreJob(job);
              job.matchScore = m.score;
              job.matchReason = m.reason;
            }

            if (job.matchScore >= MATCH_THRESHOLD) {
              matched.push(job);
              titleMatched.push(job);
            }
            console.log(`    score ${String(job.matchScore).padStart(3)} | ${job.title} — ${job.company}`);
          }

          console.log(
            `[${i + 1}/${titles.length}] "${title}": ${relevant.length} relevant, ${newCount} new, ${titleMatched.length} kept`,
          );
        } catch (err) {
          failedTitles.push(title);
          console.log(
            `[${i + 1}/${titles.length}] "${title}" SEARCH FAILED: ${(err as Error).message} — continuing`,
          );
        }

        if (!isSmoke && titleMatched.length) {
          try {
            await appendJobs(titleMatched);
          } catch (err) {
            console.log(`    sheet append failed (kept in memory): ${(err as Error).message}`);
          }
        }
      });
    }

    const okSearches = titles.length - failedTitles.length;
    console.log(
      `\nSearches ok: ${okSearches}/${titles.length}` +
        (failedTitles.length ? ` (failed: ${failedTitles.join(', ')})` : '') +
        `; unique jobs: ${seen.size}; collected: ${matched.length}`,
    );
    expect(matched.length).toBeGreaterThan(0);

    matched.sort((a, b) => b.matchScore - a.matchScore);
    const topJobs = matched.slice(0, TOP_N);

    await test.step(`Finalize: keep top ${TOP_N} by match score`, async () => {
      if (isSmoke) {
        console.log(`SMOKE — would keep top ${TOP_N} of ${matched.length} collected:`);
        topJobs.forEach((j) => console.log(`  ${j.matchScore} ${j.title} — ${j.company}`));
        return;
      }
      const result = await writeJobsToSheet(topJobs);
      console.log(
        `Wrote top ${result.rows} of ${matched.length} collected to "${result.sheetName}"` +
          (failedTitles.length ? ` (after ${failedTitles.length} failed search key(s))` : '') +
          '.',
      );
      expect(result.rows).toBeLessThanOrEqual(TOP_N);
    });

    await test.step(`Push the top ${TOP_N} to the Job Tracker API`, async () => {
      if (!trackerEnabled()) {
        console.log('JOB_TRACKER_API_KEY not set — skipping tracker push.');
        return;
      }
      if (isSmoke) {
        console.log(`SMOKE — would push ${topJobs.length} jobs to the tracker.`);
        return;
      }
      let pushed = 0;
      let dupes = 0;
      for (const j of topJobs) {
        const r = await pushApplied(j);
        if (r.ok) {
          pushed++;
          if (r.duplicate) dupes++;
          console.log(`  tracker ${r.duplicate ? 'dup' : 'new'} (${r.status}): ${j.title} — ${j.company}`);
        } else {
          console.log(`  tracker FAILED (${r.status}): ${j.title} — ${j.company} — ${r.error}`);
        }
      }
      console.log(`Pushed ${pushed}/${topJobs.length} to tracker (${dupes} duplicates).`);
    });
  });
});

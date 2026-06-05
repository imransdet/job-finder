import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { XingJobSearchPage, JobCard } from './pages/XingJobSearchPage';
import { scrapeJobDetail } from '../lib/scrape';
import { initSheet, appendJobs, keepTopJobs, JobRow } from '../lib/sheets';
import { scoreJob, loadProfile } from '../lib/match';

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 60);
const TOP_N = Number(process.env.TOP_N ?? 5);

// Search keys live in search-config.json so they can be edited without touching code.
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(resolve(__dirname, '../search-config.json'), 'utf8')) as {
  location: string;
  sincePeriod: string;
  job_titles: string[];
};
const JOB_TITLES: string[] = CONFIG.job_titles;
// Env overrides (e.g. from a Make.com repository_dispatch payload) win over the
// JSON config; empty/unset falls back to search-config.json.
const LOCATION = process.env.SEARCH_LOCATION || CONFIG.location || 'Germany';
const SINCE_PERIOD = process.env.SEARCH_SINCE_PERIOD || CONFIG.sincePeriod || 'LAST_24_HOURS';

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
  // Per search: scrape + score each job; longer budget for the LLM calls.
  test.setTimeout(40 * 60_000);

  test('per-search scrape + profile match (Z.AI), write matches, keep top 5', async ({ page }) => {
    const xing = new XingJobSearchPage(page);
    const isSmoke = !!process.env.LIMIT;
    const scoringEnabled = !!process.env.ZAI_API_KEY;
    if (!isSmoke && !scoringEnabled) {
      throw new Error('ZAI_API_KEY is required for scoring. Set it in .env (local) or as a GitHub secret (CI).');
    }
    if (scoringEnabled) loadProfile(); // fail fast if profile.md is missing

    // Dedupe the search keys themselves (case-insensitive).
    const seenTitle = new Set<string>();
    const dedupedTitles = JOB_TITLES.filter((t) => {
      const k = t.toLowerCase().trim();
      if (!k || seenTitle.has(k)) return false;
      seenTitle.add(k);
      return true;
    });

    // Optional smoke-test knob: LIMIT=3 only searches the first 3 titles.
    const titles = process.env.LIMIT ? dedupedTitles.slice(0, Number(process.env.LIMIT)) : dedupedTitles;

    // Fresh snapshot: clear the sheet and write the header once.
    if (!isSmoke) await initSheet();

    // First navigation also triggers the cookie consent; accept it once.
    await page.goto(xing.buildSearchUrl(titles[0], LOCATION, SINCE_PERIOD), { waitUntil: 'domcontentloaded' });
    await xing.acceptCookies();

    const seen = new Set<string>(); // global dedupe across all searches
    const matched: JobRow[] = []; // jobs that passed the threshold (for smoke logging)
    let totalNew = 0;
    let totalMatched = 0;

    for (const [i, title] of titles.entries()) {
      await test.step(`Search "${title}" → scrape → score → write matches`, async () => {
        const cards = await xing.collectCardsForKeyword(title, LOCATION, SINCE_PERIOD);
        const relevant = cards.filter((c) => isRelevant(c.title));
        let newCount = 0;
        let matchedCount = 0;

        for (const card of relevant) {
          const key = dedupeKey(card);
          if (seen.has(key)) continue; // already handled by an earlier search
          seen.add(key);

          let job: JobRow;
          try {
            job = await scrapeJobDetail(page, card);
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
            matchedCount++;
            if (!isSmoke) await appendJobs([job]); // write match immediately
          }
          console.log(`    score ${String(job.matchScore).padStart(3)} | ${job.title} — ${job.company}`);
        }

        totalNew += newCount;
        totalMatched += matchedCount;
        console.log(
          `[${i + 1}/${titles.length}] "${title}": ${relevant.length} relevant, ${newCount} new, ${matchedCount} matched (≥${MATCH_THRESHOLD})`
        );
      });
    }

    console.log(`\nNew unique jobs: ${totalNew}; matched (≥${MATCH_THRESHOLD}): ${totalMatched}`);
    expect(seen.size).toBeGreaterThan(0);

    await test.step(`Keep only the top ${TOP_N} by match score`, async () => {
      if (isSmoke) {
        matched.sort((a, b) => b.matchScore - a.matchScore);
        console.log(`SMOKE — would keep top ${TOP_N} of ${matched.length} matched:`);
        matched.slice(0, TOP_N).forEach((j) => console.log(`  ${j.matchScore} ${j.title} — ${j.company}`));
        return;
      }
      const result = await keepTopJobs(TOP_N);
      console.log(`Kept top ${result.kept} of ${result.total} matched jobs in the sheet.`);
      expect(result.kept).toBeLessThanOrEqual(TOP_N);
    });
  });
});

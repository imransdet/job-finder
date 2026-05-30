import { test, expect } from '@playwright/test';
import { XingJobSearchPage, JobCard } from './pages/XingJobSearchPage';
import { scrapeJobDetail } from '../lib/scrape';
import { writeJobsToSheet, JobRow } from '../lib/sheets';

const KEYWORD = 'QA Automation Engineer';
const LOCATION = 'Germany';

test.describe('Xing job collection', () => {
  // Visiting every job detail page takes a while.
  test.setTimeout(300_000);

  test('collect Past-24h QA Automation Engineer jobs and write to Google Sheet', async ({ page }) => {
    const xing = new XingJobSearchPage(page);

    await test.step('Search QA Automation Engineer in Germany', async () => {
      await xing.goto();
      await xing.acceptCookies();
      await xing.openSearch();
      await xing.enterKeyword(KEYWORD);
      await xing.enterLocation(LOCATION);
      await xing.submitSearch();
      await xing.dismissFeedbackPopup();
      await expect(xing.locationChip).toBeVisible();
    });

    let jobCards: JobCard[] = [];
    await test.step('Apply "Past 24 hours" filter and collect job cards', async () => {
      await xing.filterPast24Hours();
      const count = await xing.getJobCount();
      jobCards = await xing.getJobCards();
      console.log(`Filtered job count: ${count}; collected ${jobCards.length} job cards`);
      expect(jobCards.length).toBeGreaterThan(0);
    });

    const jobs: JobRow[] = [];
    await test.step('View each job and scrape its data', async () => {
      for (const [i, card] of jobCards.entries()) {
        const job = await scrapeJobDetail(page, card);
        jobs.push(job);
        console.log(`[${i + 1}/${jobCards.length}] ${job.title} — ${job.company} — ${job.location} — ${job.workplace} — ${job.salary}`);
        expect(job.title.length).toBeGreaterThan(0);
      }
      expect(jobs.length).toBe(jobCards.length);
    });

    await test.step('Write the collected jobs to the Google Sheet', async () => {
      const result = await writeJobsToSheet(jobs);
      console.log(`Wrote ${result.rows} rows to "${result.sheetName}" (spreadsheet ${result.spreadsheetId})`);
      expect(result.rows).toBe(jobs.length);
    });
  });
});

import { test, expect } from '@playwright/test';
import { XingJobSearchPage } from './pages/XingJobSearchPage';

const KEYWORD = 'QA Automation Engineer';
const LOCATION = 'Germany';

test.describe('Xing job search', () => {
  test('search "QA Automation Engineer" in Germany and validate job count', async ({ page }) => {
    const xing = new XingJobSearchPage(page);
    let unfilteredCount = 0; // count before applying the date filter, for comparison

    await test.step('Open Xing and accept cookies', async () => {
      await xing.goto();
      await xing.acceptCookies();
    });

    await test.step('Click the search field', async () => {
      await xing.openSearch();
    });

    await test.step(`Enter keyword "${KEYWORD}"`, async () => {
      await xing.enterKeyword(KEYWORD);
    });

    await test.step(`Select location "${LOCATION}"`, async () => {
      await xing.enterLocation(LOCATION);
    });

    await test.step('Click the search (right-arrow) button', async () => {
      await xing.submitSearch();
    });

    await test.step('Close the feedback pop-up if it appears', async () => {
      await xing.dismissFeedbackPopup();
    });

    await test.step('Validate the search results', async () => {
      // URL carries the search criteria.
      await expect(page).toHaveURL(/keywords=QA(\+|%20)Automation(\+|%20)Engineer/i);
      await expect(page).toHaveURL(/location=Germany/i);

      // Location filter chip confirms Germany was applied.
      await expect(xing.locationChip).toBeVisible();

      // Job-count heading is shown, e.g. "99+ jobs found".
      const countText = await xing.getJobCountText();
      console.log(`Job count heading: "${countText}"`);
      expect(countText).toMatch(/jobs found/i);

      const count = await xing.getJobCount();
      unfilteredCount = count;
      console.log(`Parsed job count: ${count}`);
      expect(count).toBeGreaterThan(0);

      // At least one job card is rendered.
      await expect(xing.jobResults.first()).toBeVisible();
      const cards = await xing.jobResults.count();
      console.log(`Job cards on page: ${cards}`);
      expect(cards).toBeGreaterThan(0);
    });

    await test.step('Apply the "Past 24 hours" date filter and re-check the count', async () => {
      await xing.filterPast24Hours();

      // Re-check the job count after filtering and print it.
      const filteredText = await xing.getJobCountText();
      const filteredCount = await xing.getJobCount();
      console.log(`Job count after "Past 24 hours" filter: "${filteredText}" (parsed: ${filteredCount})`);
      expect(filteredText).toMatch(/jobs found/i);

      // The filtered set must be a valid, non-empty result set.
      expect(filteredCount).toBeGreaterThan(0);

      // Applying a date filter narrows results, so it can never exceed the
      // unfiltered total ("99+" is a capped display, hence <=).
      console.log(`Count change: ${unfilteredCount} (unfiltered) -> ${filteredCount} (Past 24 hours)`);
      expect(filteredCount).toBeLessThanOrEqual(unfilteredCount);

      // Validate the heading count against the rendered cards. Xing pages ~20
      // results, so when the filtered total fits on one page it must match the
      // number of cards shown.
      await expect(xing.jobResults.first()).toBeVisible();
      const filteredCards = await xing.jobResults.count();
      console.log(`Job cards after filter: ${filteredCards}`);
      expect(filteredCards).toBeGreaterThan(0);
      if (filteredCount <= 20) {
        expect(filteredCards).toBe(filteredCount);
      }
    });
  });
});

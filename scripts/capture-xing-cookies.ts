/**
 * One-time setup: log in to Xing in a headed browser, then this script
 * captures the session cookies and prints them as JSON for use as the
 * XING_COOKIES GitHub Actions secret.
 *
 * Usage:
 *   npx tsx scripts/capture-xing-cookies.ts
 *
 * Then copy the printed JSON and add it as a secret named XING_COOKIES in:
 *   GitHub → repo → Settings → Secrets and variables → Actions → New secret
 *
 * Renew the cookies every few weeks when the Xing session expires.
 */

import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
  });
  const page = await ctx.newPage();

  await page.goto('https://www.xing.com/jobs');

  console.log('\n====================================================');
  console.log('Log in to Xing in the browser window that just opened.');
  console.log('When you are fully logged in and see the jobs page,');
  console.log('come back here and press ENTER.');
  console.log('====================================================\n');

  await new Promise<void>((resolve) => {
    process.stdout.write('Press ENTER when logged in > ');
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', () => resolve());
  });

  const allCookies = await ctx.cookies();
  const xingCookies = allCookies.filter((c) => c.domain.includes('xing.com'));

  const json = JSON.stringify(xingCookies, null, 2);

  // Write to file as well so you can copy it easily.
  const outFile = 'xing-cookies.json';
  writeFileSync(outFile, json, 'utf8');

  console.log('\n====================================================');
  console.log(`Captured ${xingCookies.length} cookies — saved to ${outFile}`);
  console.log('Add the CONTENTS of that file as the XING_COOKIES GitHub secret.');
  console.log('(Paste the JSON array including the outer [ ] brackets.)');
  console.log('====================================================\n');

  await browser.close();
  process.exit(0);
})();

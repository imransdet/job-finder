import { defineConfig, devices } from '@playwright/test';

/**
 * Browser mode is environment-driven:
 *  - Local default: HEADED with real Google Chrome (so you can watch it).
 *  - CI (process.env.CI) default: HEADLESS.
 *  - Override explicitly with HEADLESS=true|false.
 *
 * Channel:
 *  - Default: real Google Chrome ('chrome').
 *  - Set BROWSER_CHANNEL='' (empty) to use Playwright's bundled Chromium
 *    (recommended in CI — no Google Chrome install needed).
 */
const headless = process.env.HEADLESS ? process.env.HEADLESS === 'true' : !!process.env.CI;
const channel = 'BROWSER_CHANNEL' in process.env ? process.env.BROWSER_CHANNEL || undefined : 'chrome';

export default defineConfig({
  testDir: './tests',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless,
    channel,
    viewport: { width: 1366, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    locale: 'en-US',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel, headless },
    },
  ],
});

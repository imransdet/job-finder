# Xing Job Search — Playwright Automation

Automates Xing's job search and validates the results count.

**Flow:** open https://www.xing.com → accept cookies → click the search field →
enter `QA Automation Engineer` → set location `Germany` → click the right-arrow
search button → close the feedback pop-up → validate the "jobs found" count.

## Run

```bash
npm install            # first time only
npx playwright install chrome   # if Chrome isn't already present

npm test               # headed, real Google Chrome (configured by default)
npm run test:debug     # step through with the Playwright Inspector
npm run report         # open the last HTML report
```

The run is **headed with real Chrome** (see `playwright.config.ts`) so you can
watch it happen.

## Layout

- `tests/xing-job-search.spec.ts` — the test case (with `test.step` for readable output)
- `tests/pages/XingJobSearchPage.ts` — Page Object with all selectors
- `playwright.config.ts` — headed + `channel: 'chrome'`, traces/video on failure

## What it validates

- URL carries `keywords` and `location=Germany`
- "Location: Germany" filter chip is shown
- The "<n> jobs found" heading is present and the parsed count is > 0
- At least one job card (`data-testid=job-search-result`) is rendered

## Notes

Selectors were verified against the live site (May 2026). Because this drives a
live third-party site, the markup may change over time — the Page Object
centralizes selectors so updates are one-file changes.

## Collect, match against your profile, keep top 5

`tests/xing-all-titles-to-sheet.spec.ts` is the main pipeline. For **each** title
in `search-config.json` it:

1. searches (configured location, Past 24h) and keeps QA/testing-relevant cards,
2. scrapes each new (deduped) job's detail page,
3. **scores the job against your profile** ([`profile.md`](profile.md)) via
   **Z.AI (Zhipu GLM)**, and
4. records the job with its score.

Then, after all titles, it **keeps only the top `TOP_N` (default 5)** rows by match
score and deletes the rest. By default (`MATCH_THRESHOLD=0`) the top N are always
kept so the list is never empty; set `MATCH_THRESHOLD` (e.g. 60) to only keep jobs
at/above that score. The sheet gains **`Match Score`** and **`Match Reason`**
columns (score is column A, so the sheet is pre-sorted by fit).

```bash
npx playwright test xing-all-titles-to-sheet --headed
# Smoke-test the first N titles without writing to the sheet:
LIMIT=4 npx playwright test xing-all-titles-to-sheet --headed
```

Requires `ZAI_API_KEY` (see [`.env`](.env.example) locally / GitHub secret in CI).
Edit your profile in [`profile.md`](profile.md) to change how matches are scored.
Tune `MATCH_THRESHOLD` and `TOP_N` via env vars.

Finally, if `JOB_TRACKER_API_KEY` is set, the same top `TOP_N` are **pushed to the
Job Tracker API** (`POST /api/ingest/applied`, idempotent on company+title) so the
list is available there too. Unset the key to skip the push.

## Public "top matches" endpoint (GitHub Pages)

Each run also generates a shareable endpoint in `site/` and the workflow deploys
it to **GitHub Pages** — no server or keys needed:

- **JSON API:** `https://imransdet.github.io/job-finder/top-matches.json`
- **Web view:** `https://imransdet.github.io/job-finder/`

The JSON contains `generatedAt`, `location`, `sincePeriod`, `count`, and a `jobs`
array (rank, matchScore, matchReason, title, company, location, workplace,
employmentType, salary, posted, url, foundVia).

**One-time setup:** repo **Settings → Pages → Source: GitHub Actions**. After the
next successful run, the URLs above go live (and refresh on every run).

### Editing the search keys — `search-config.json`

Add/remove search terms here (no code changes needed):

```json
{
  "location": "Germany",
  "sincePeriod": "LAST_24_HOURS",
  "job_titles": ["QA Engineer", "Software Tester", "Senior SDET", "..."]
}
```

- `location` — e.g. `"Germany"`, `"Berlin"`.
- `sincePeriod` — `LAST_24_HOURS`, `LAST_7_DAYS`, `LAST_30_DAYS`, or `""` for any time.
- `job_titles` — the list of search keys; each is searched separately, then results are deduped.

Output adds a **"Found Via (search terms)"** column showing which title(s) matched
each job. A QA/testing relevance filter (`QA_RELEVANCE` in the spec) drops
unrelated jobs that Xing's AI search pads in.

## Collect jobs into Google Sheets (single search)

`tests/xing-collect-to-sheet.spec.ts` runs the full search, applies the
**Past 24 hours** filter, opens **each** job's detail page, scrapes every field,
and writes a fresh snapshot to a Google Sheet.

```bash
npx playwright test xing-collect-to-sheet --headed
```

Columns written: Title, Company, Location, Workplace, Employment Type, Salary,
Posted, Badge, URL, Description, Scraped At.

### Credentials (`.env`)

Configuration lives in `.env` (git-ignored — **never commit it**):

```
GOOGLE_CLIENT_EMAIL=...      # service account email
GOOGLE_PRIVATE_KEY="..."     # service account private key (keep the \n escapes)
GOOGLE_SHEET_ID=...          # target spreadsheet ID
GOOGLE_SHEET_NAME=...        # target tab name (created automatically if missing)
```

**Important:** the spreadsheet must be shared with the service account email
(`GOOGLE_CLIENT_EMAIL`) as an Editor, or the API returns 403.

- `lib/sheets.ts` — Google Sheets auth + snapshot writer (clears the tab, writes header + rows)
- `lib/scrape.ts` — extracts every field from a job detail page

## Run headless on GitHub Actions

A scheduled, headless CI workflow is included
([`.github/workflows/xing-jobs.yml`](.github/workflows/xing-jobs.yml)). Locally
it runs headed; in CI it runs headless with bundled Chromium and credentials from
**repository Secrets**.

### Configure GitHub Secrets

Credentials are **never committed** (`.env` is git-ignored). In CI they come from
GitHub Secrets instead. In your repo go to:

**Settings → Secrets and variables → Actions → New repository secret**

Add these four secrets (names must match exactly):

| Secret name           | Where to get the value |
|-----------------------|------------------------|
| `GOOGLE_CLIENT_EMAIL` | `client_email` from the service-account JSON |
| `GOOGLE_PRIVATE_KEY`  | `private_key` from the JSON (paste as-is, including the `\n`) |
| `GOOGLE_SHEET_ID`     | The spreadsheet ID from its URL |
| `GOOGLE_SHEET_NAME`   | The tab name, e.g. `xing-raw-data` |
| `ZAI_API_KEY`         | Your Z.AI (Zhipu GLM) API key, for match scoring |
| `JOB_TRACKER_API_KEY` | (Optional) Job Tracker ingest API key, to push top matches |

Or via the GitHub CLI:

```bash
gh secret set GOOGLE_CLIENT_EMAIL  --body "my-job-finder@your-project.iam.gserviceaccount.com"
gh secret set GOOGLE_PRIVATE_KEY   < private_key.txt   # file containing the key
gh secret set GOOGLE_SHEET_ID      --body "your-spreadsheet-id"
gh secret set GOOGLE_SHEET_NAME    --body "xing-raw-data"
gh secret set ZAI_API_KEY          --body "your-zai-api-key"
gh secret set JOB_TRACKER_API_KEY  --body "your-ingest-api-key"   # optional
```

Optional repo **variables** (not secrets): `MATCH_THRESHOLD` (default 60) and
`TOP_N` (default 5).

Notes:
- **Private key:** paste exactly as it appears in the JSON (single line with `\n`
  escapes). The code normalizes `\n` to real newlines, so a multi-line paste also
  works. Wrap in quotes if your shell needs it.
- **Share the sheet** with `GOOGLE_CLIENT_EMAIL` as an **Editor**, or the Sheets
  API returns 403.
- These are **repository secrets** (not environment secrets) and are not exposed
  to pull requests from forks.

### Triggers

- **Scheduled (GitHub cron):** daily at **23:17 UTC** (`cron: '17 23 * * *'`),
  which is **01:17 local (CEST)**. GitHub cron is fixed UTC and ignores DST, so
  in winter (CET) it lands at 00:17 local — adjust the hour if needed.
- **Manual:** Actions tab → *Xing job collector* → **Run workflow**.
- **External (Make.com / any HTTP client):** via the GitHub *repository dispatch*
  API (optional; usable alongside the cron). See below.

### Trigger from Make.com (with daily 2 PM schedule)

Make.com both **schedules** the run and **triggers** it: a scheduled scenario
fires a single HTTP request that raises a `repository_dispatch` event of type
`run-xing-collector`, which starts the workflow.

**1. Create a GitHub token** (used by Make to authenticate):
- *Fine-grained PAT* — repo `imransdet/job-finder`, Repository permissions →
  **Contents: Read and write** (required by the dispatch API), or
- *Classic PAT* — `repo` scope.

Store it in Make as a connection/keychain value (don't hard-code it).

**2. Add the schedule (daily 2 PM)** — this replaces GitHub's cron:
- Create a new scenario. The first module is the **trigger**.
- Either start the scenario with a **Schedule** trigger, or click the scenario's
  clock/schedule control at the bottom-left and set:
  - **Run scenario:** *Every day*
  - **Time:** `14:00`
  - **Timezone:** set it in the scenario's *Scheduling* settings (Make uses the
    timezone of your Make organization/scenario — pick your local zone so 2 PM
    means 2 PM for you).
- Make's free plan has a minimum interval (e.g. 15 min); a once-daily run is fine.

**3. Add an HTTP → “Make a request” module** after the trigger:

| Field | Value |
|-------|-------|
| URL | `https://api.github.com/repos/imransdet/job-finder/dispatches` |
| Method | `POST` |
| Header | `Accept: application/vnd.github+json` |
| Header | `Authorization: Bearer YOUR_GITHUB_TOKEN` |
| Header | `X-GitHub-Api-Version: 2022-11-28` |
| Header | `User-Agent: make.com` |
| Body type | Raw / `application/json` |

**Body (JSON):**

```json
{
  "event_type": "run-xing-collector",
  "client_payload": {
    "location": "Germany",
    "since_period": "LAST_24_HOURS"
  }
}
```

- `client_payload` is **optional**. Omit it to use the values in
  `search-config.json`. When present, `location` / `since_period` override the
  config for that run (the job titles always come from `search-config.json`).
- `since_period`: `LAST_24_HOURS`, `LAST_7_DAYS`, `LAST_30_DAYS`, or `""` (any time).
- **Success = HTTP `204 No Content`** (the API returns no body). The Action then
  starts; watch it in the repo's **Actions** tab.

> Tip: a quick `curl` sanity check before wiring Make:
> ```bash
> curl -X POST \
>   -H "Accept: application/vnd.github+json" \
>   -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
>   -H "X-GitHub-Api-Version: 2022-11-28" \
>   https://api.github.com/repos/imransdet/job-finder/dispatches \
>   -d '{"event_type":"run-xing-collector"}'
> ```

See **[GITHUB_ACTIONS.md](GITHUB_ACTIONS.md)** for the complete walkthrough
(pushing the repo, customizing the search, local-vs-CI behavior, gotchas).

## Playwright MCP

A `playwright` MCP server is configured in `.mcp.json` for interactive,
AI-driven browser control inside Claude Code (restart the session to load it).

# Running on GitHub Actions (headless, scheduled)

This guide gets the Xing job collector running **headless** in CI and writing to
your Google Sheet on a schedule. Locally it still runs **headed** so you can
watch; CI runs headless automatically.

---

## 1. Push the project to GitHub

The repo isn't initialized yet. From the project root:

```bash
git init
git add .
git commit -m "Xing job collector with Playwright + Google Sheets"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

> ✅ `.gitignore` already excludes `.env`, `node_modules/`, `test-results/`,
> `playwright-report/`, and `*.json` service-account files — so **no secrets get
> committed**. `package-lock.json` *is* committed (needed for `npm ci`).

Verify before pushing that `.env` is ignored:

```bash
git status --short      # .env must NOT appear
```

---

## 2. Add the GitHub Secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**.
Create these four secrets (names must match exactly):

| Secret name           | Value |
|-----------------------|-------|
| `GOOGLE_CLIENT_EMAIL` | The `client_email` from your service-account JSON |
| `GOOGLE_PRIVATE_KEY`  | The `private_key` from the JSON (see note below) |
| `GOOGLE_SHEET_ID`     | `1Cc6D0W6Xv9RB9E8tbosxUuqngnakqY5r270IXEWsCQ4` |
| `GOOGLE_SHEET_NAME`   | `xing-raw-data` |

**Private key format:** paste the `private_key` value exactly as it appears in
the JSON — a single line containing `\n` sequences, e.g.
`-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n`.
The code normalizes `\n` to real newlines, so a multi-line paste works too.

**Sheet access:** the spreadsheet must be shared with `GOOGLE_CLIENT_EMAIL`
as an **Editor**, or the API returns 403.

---

## 3. The workflow

[`.github/workflows/xing-jobs.yml`](.github/workflows/xing-jobs.yml) is already
included. It:

1. Checks out the repo and installs deps with `npm ci`.
2. Installs Playwright's bundled **Chromium** (`--with-deps`).
3. Runs `npx playwright test xing-all-titles-to-sheet` with `HEADLESS=true` and
   `BROWSER_CHANNEL=''` (bundled Chromium, no Google Chrome needed in CI).
4. Uploads the Playwright HTML report as an artifact (handy for debugging).

### Triggers
- **External (Make.com):** the primary trigger. A scheduled Make.com scenario
  raises a `repository_dispatch` event of type `run-xing-collector` (daily at
  2 PM, or whenever you choose). See the **"Trigger from Make.com"** section in
  [README.md](README.md).
- **Manual:** Actions tab → *Xing job collector* → **Run workflow**.

> GitHub's own `schedule:` cron is intentionally **not** enabled — Make.com owns
> the scheduling, so GitHub won't send scheduled-run emails. Add a `schedule:`
> block to the workflow if you ever want GitHub to run it directly (cron is UTC).

---

## 4. Customizing the search

Edit [`search-config.json`](search-config.json) — no code changes needed:

```json
{
  "location": "Germany",
  "sincePeriod": "LAST_24_HOURS",
  "job_titles": ["QA Engineer", "Software Tester", "Senior SDET"]
}
```

- `sincePeriod`: `LAST_24_HOURS` (matches a daily run), `LAST_7_DAYS`,
  `LAST_30_DAYS`, or `""` for any time. (A Make.com payload can override this
  per run.)
- Duplicate search keys and duplicate jobs (incl. recruiter reposts) are removed
  automatically.

Commit and push the change; the next run uses it.

---

## 5. Local vs CI behavior

| | Local | GitHub Actions |
|---|---|---|
| Browser mode | **Headed** (visible) | **Headless** |
| Browser | Google Chrome (`channel: 'chrome'`) | Bundled Chromium |
| Credentials | `.env` file | Repository Secrets |

Override locally if needed:

```bash
HEADLESS=true npx playwright test xing-all-titles-to-sheet     # force headless
BROWSER_CHANNEL='' npx playwright test xing-all-titles-to-sheet # force bundled Chromium
```

---

## 6. Notes & gotchas

- **Runtime:** a full run opens every unique job's detail page sequentially and
  can take ~20–25 min. The workflow's `timeout-minutes: 45` covers it. Ask if you
  want it parallelized.
- **Scheduling is in Make.com,** not GitHub — so there's no GitHub-cron email and
  no 60-day auto-disable to worry about. Make.com fires the run on its own clock.
- **The sheet is overwritten** each run (fresh snapshot). If you'd rather append
  with a run-date column, that's a small change — just ask.
- **Rotate the key** if it was ever exposed in plaintext; update the
  `GOOGLE_PRIVATE_KEY` secret afterward.

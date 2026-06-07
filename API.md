# Top Matches — shared data source

The daily top matches are shared via a **Google Sheet**, not a public web
endpoint (both repos are private, so GitHub Pages isn't used). The consuming
project (e.g. the Job Tracker) reads the sheet directly with **its own Google
service account**.

## How to consume

1. **Share the sheet** with the consuming project's service-account email
   (Viewer is enough for read-only).
   - Spreadsheet ID: `1Cc6D0W6Xv9RB9E8tbosxUuqngnakqY5r270IXEWsCQ4`
   - Tab (sheet name): `xing-raw-data`
2. **Read it** via the Google Sheets API, e.g.:

   ```js
   // googleapis (Node) — read the top matches tab
   const sheets = google.sheets({ version: 'v4', auth }); // service-account JWT
   const res = await sheets.spreadsheets.values.get({
     spreadsheetId: '1Cc6D0W6Xv9RB9E8tbosxUuqngnakqY5r270IXEWsCQ4',
     range: 'xing-raw-data',
   });
   const [header, ...rows] = res.data.values; // row 1 = header
   ```

## Sheet contract

- **Row 1** is the header; **rows 2…N** are the matches.
- The sheet is overwritten each run and holds only the **top N** (default 5),
  already **sorted by Match Score descending** (column A).
- Columns (A → N):

  | Col | Header | Notes |
  |-----|--------|-------|
  | A | Match Score | integer 0–100 |
  | B | Match Reason | why it scored that |
  | C | Title | |
  | D | Company | |
  | E | Location | |
  | F | Workplace | Remote / Hybrid / On-site |
  | G | Employment Type | e.g. Full-time |
  | H | Salary | range or empty |
  | I | Posted | e.g. "21 hours ago" |
  | J | Badge | e.g. "Be an early applicant" |
  | K | URL | original posting |
  | L | Description | full text |
  | M | Found Via (search terms) | search key that surfaced it |
  | N | Scraped At | ISO 8601 timestamp |

## Update cadence

The sheet is refreshed on every pipeline run (scheduled daily, plus manual /
Make.com triggers). Use the **Scraped At** column to know how fresh the data is.

## Optional: push to the Job Tracker API instead

If you'd rather have the matches pushed (instead of pulled from the sheet), set
`JOB_TRACKER_API_KEY` and the pipeline will `POST` the top N to the Job Tracker
ingest endpoint (`/api/ingest/applied`, idempotent on company+title).

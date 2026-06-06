# Top Matches API

A read-only, public JSON endpoint with the daily top job matches. Updated on
every pipeline run (scheduled daily, plus manual / Make.com triggers).

## Endpoint

```
GET https://imransdet.github.io/job-finder/top-matches.json
```

- **Auth:** none — public, read-only.
- **Method:** `GET` only.
- **Format:** `application/json`.
- **Human view:** https://imransdet.github.io/job-finder/
- **Update cadence:** once per pipeline run (default: daily). Check the
  `generatedAt` field for the actual time of the data.

## Response `200 OK`

```json
{
  "generatedAt": "2026-06-06T05:57:16.434Z",
  "location": "Germany",
  "sincePeriod": "LAST_24_HOURS",
  "count": 5,
  "jobs": [
    {
      "rank": 1,
      "matchScore": 85,
      "matchReason": "Strong match for web/mobile/API automation, located in Germany ...",
      "title": "QA Engineer (m/w/d) Web & Mobile",
      "company": "APRIORI – BUSINESS SOLUTIONS AG",
      "location": "Frankfurt am Main, Germany",
      "workplace": "On-site",
      "employmentType": "Full-time",
      "salary": "€53,000 – €70,000",
      "posted": "21 hours ago",
      "url": "https://www.xing.com/jobs/...-155007818",
      "foundVia": "QA Engineer"
    }
  ]
}
```

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `generatedAt` | string (ISO 8601, UTC) | When this data was produced. Use it to detect updates. |
| `location` | string | Search location (e.g. `Germany`). |
| `sincePeriod` | string | Recency window: `LAST_24_HOURS`, `LAST_7_DAYS`, `LAST_30_DAYS`, or `""`. |
| `count` | integer | Number of jobs in `jobs` (≤ TOP_N, default 5). |
| `jobs` | array | The ranked matches (best first). |

### `jobs[]` fields

| Field | Type | Description |
|-------|------|-------------|
| `rank` | integer | 1-based rank (1 = best match). |
| `matchScore` | integer (0–100) | Profile match score. |
| `matchReason` | string | Short explanation of the score. |
| `title` | string | Job title. |
| `company` | string | Company name. |
| `location` | string | Job location. |
| `workplace` | string | `Remote`, `Hybrid`, `On-site` (as published). |
| `employmentType` | string | e.g. `Full-time`. |
| `salary` | string | Salary range if available, else `""`. |
| `posted` | string | Relative posted time (e.g. `21 hours ago`). |
| `url` | string | Original job posting URL. |
| `foundVia` | string | Search term that surfaced the job. |

## Consuming the API

### cURL
```bash
curl -s https://imransdet.github.io/job-finder/top-matches.json | jq '.jobs[] | {rank, matchScore, title, company, url}'
```

### JavaScript
```javascript
const res = await fetch("https://imransdet.github.io/job-finder/top-matches.json");
const data = await res.json();
console.log(data.generatedAt, data.count);
data.jobs.forEach(j => console.log(j.rank, j.matchScore, j.title, j.url));
```

### Python
```python
import requests
data = requests.get("https://imransdet.github.io/job-finder/top-matches.json").json()
print(data["generatedAt"], data["count"])
for j in data["jobs"]:
    print(j["rank"], j["matchScore"], j["title"], j["url"])
```

## Polling & caching requirements

- **Served via a CDN (GitHub Pages / Fastly) over HTTPS.** Responses are cached
  briefly (typically up to ~10 minutes), so a fresh value may lag the run by a
  few minutes.
- **Detect updates** by comparing `generatedAt`, or use conditional requests:
  the response carries `ETag` / `Last-Modified`. Send `If-None-Match: <etag>` (or
  `If-Modified-Since`) and treat **`304 Not Modified`** as "no change".
- **Polling frequency:** the data changes at most once per run (daily by
  default). Polling more than ~hourly is unnecessary. The scheduled run is around
  **23:17 UTC**; poll shortly after if you want the freshest data.
- **CORS:** if a browser app can't fetch it cross-origin, fetch server-side or
  via a small proxy.

## Errors / availability

There is no application-level error contract — it's a static file. Standard HTTP
applies:

| Status | Meaning |
|--------|---------|
| `200` | OK — current data. |
| `304` | Not Modified (conditional request). |
| `404` | Endpoint not deployed yet (run the pipeline / enable Pages). |
| `5xx` | Temporary CDN/Pages issue — retry with backoff. |

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JobRow } from './sheets';

export interface SiteMeta {
  location: string;
  sincePeriod: string;
}

const esc = (s: string) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Generate the public "top matches" endpoint as static files:
 *   - <outDir>/top-matches.json  (the API)
 *   - <outDir>/index.html        (human-readable view)
 * These are deployed to GitHub Pages by the workflow.
 */
export function publishSite(jobs: JobRow[], meta: SiteMeta, outDir = 'site') {
  const dir = resolve(process.cwd(), outDir);
  mkdirSync(dir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    location: meta.location,
    sincePeriod: meta.sincePeriod,
    count: jobs.length,
    jobs: jobs.map((j, i) => ({
      rank: i + 1,
      matchScore: j.matchScore,
      matchReason: j.matchReason,
      title: j.title,
      company: j.company,
      location: j.location,
      workplace: j.workplace,
      employmentType: j.employmentType,
      salary: j.salary,
      posted: j.posted,
      url: j.url,
      foundVia: j.foundVia,
    })),
  };

  writeFileSync(resolve(dir, 'top-matches.json'), JSON.stringify(payload, null, 2));

  const rows = jobs
    .map(
      (j, i) => `
      <tr>
        <td class="rank">${i + 1}</td>
        <td class="score">${j.matchScore}</td>
        <td><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
            <div class="reason">${esc(j.matchReason)}</div></td>
        <td>${esc(j.company)}</td>
        <td>${esc(j.location)} ${j.workplace ? `· ${esc(j.workplace)}` : ''}</td>
        <td>${esc(j.salary)}</td>
        <td>${esc(j.posted)}</td>
      </tr>`
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Top job matches</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 1000px; padding: 0 1rem; }
  h1 { margin-bottom: .25rem; }
  .meta { color: #888; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .55rem .6rem; border-bottom: 1px solid #8884; vertical-align: top; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .03em; color: #888; }
  .rank, .score { text-align: center; font-variant-numeric: tabular-nums; }
  .score { font-weight: 700; }
  .reason { color: #888; font-size: .85rem; margin-top: .15rem; }
  a { color: #2a7ae2; text-decoration: none; } a:hover { text-decoration: underline; }
  code { background: #8882; padding: .1rem .35rem; border-radius: 4px; }
</style>
</head>
<body>
  <h1>Top job matches</h1>
  <p class="meta">
    Location: <strong>${esc(meta.location)}</strong> ·
    Window: <strong>${esc(meta.sincePeriod)}</strong> ·
    ${jobs.length} match${jobs.length === 1 ? '' : 'es'} ·
    Updated ${esc(generatedAt)}<br>
    JSON API: <a href="./top-matches.json"><code>top-matches.json</code></a>
  </p>
  <table>
    <thead><tr><th>#</th><th>Score</th><th>Role</th><th>Company</th><th>Location</th><th>Salary</th><th>Posted</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">No matches in this run.</td></tr>'}</tbody>
  </table>
</body>
</html>`;

  writeFileSync(resolve(dir, 'index.html'), html);
  return { dir, jsonPath: resolve(dir, 'top-matches.json'), count: jobs.length };
}

import 'dotenv/config';
import { JobRow } from './sheets';

// Job Tracker external API (https://myjobtracker0.netlify.app/api).
const BASE_URL = (process.env.JOB_TRACKER_API_URL || 'https://myjobtracker0.netlify.app/api').replace(/\/$/, '');
const API_KEY = process.env.JOB_TRACKER_API_KEY;
const PLATFORM = process.env.JOB_TRACKER_PLATFORM || 'Xing';

export interface PushResult {
  ok: boolean;
  status: number;
  duplicate?: boolean;
  error?: string;
}

/** True if a tracker API key is configured (push is otherwise skipped). */
export function trackerEnabled(): boolean {
  return !!API_KEY;
}

/**
 * Push one matched job to the tracker's ingest endpoint. Idempotent server-side
 * (same company + title is skipped and returns duplicate: true). Retries on
 * transient failures.
 */
export async function pushApplied(job: JobRow): Promise<PushResult> {
  if (!API_KEY) throw new Error('Missing JOB_TRACKER_API_KEY');

  const body = {
    title: job.title,
    company: job.company,
    platform: PLATFORM,
    // dateApplied defaults to today on the server; omit it.
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/ingest/applied`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, status: res.status, error: data?.error ?? `HTTP ${res.status}` };
      }
      return { ok: true, status: res.status, duplicate: !!data?.duplicate };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  return { ok: false, status: 0, error: (lastErr as Error)?.message ?? 'request failed' };
}

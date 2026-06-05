import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JobRow } from './sheets';

// Z.AI (Zhipu GLM) — OpenAI-compatible chat completions API.
const BASE_URL = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
const MODEL = process.env.ZAI_MODEL || 'glm-4.6';
const API_KEY = process.env.ZAI_API_KEY;

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The candidate profile, loaded once from profile.md. */
let cachedProfile: string | null = null;
export function loadProfile(): string {
  if (cachedProfile === null) {
    cachedProfile = readFileSync(resolve(__dirname, '../profile.md'), 'utf8');
  }
  return cachedProfile;
}

export interface MatchResult {
  score: number; // 0–100
  reason: string;
}

const SYSTEM_PROMPT =
  'You are a recruiter assistant. Given a candidate profile and a job posting, ' +
  'rate how well the job matches the candidate from 0 to 100, where 100 is a ' +
  'perfect fit. Consider role/skills overlap, seniority, location/work ' +
  'authorization, and the candidate\'s stated preferences. Respond ONLY with a ' +
  'JSON object: {"score": <integer 0-100>, "reason": "<one or two sentences>"}.';

function buildUserPrompt(profile: string, job: JobRow): string {
  return [
    '=== CANDIDATE PROFILE ===',
    profile.trim(),
    '',
    '=== JOB POSTING ===',
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location}`,
    `Workplace: ${job.workplace}`,
    `Employment type: ${job.employmentType}`,
    `Salary: ${job.salary}`,
    `Description: ${(job.description || '').slice(0, 4000)}`,
    '',
    'Return the JSON now.',
  ].join('\n');
}

function parseResult(content: string): MatchResult {
  // Be tolerant of code fences or stray text around the JSON.
  const json = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
  const obj = JSON.parse(json);
  const score = Math.max(0, Math.min(100, Math.round(Number(obj.score))));
  return { score: Number.isFinite(score) ? score : 0, reason: String(obj.reason ?? '').trim() };
}

/**
 * Score a job against the candidate profile via Z.AI. Retries a couple of times;
 * on persistent failure returns score 0 with the error noted (so the run
 * continues and the job simply won't clear the threshold).
 */
export async function scoreJob(job: JobRow, profile = loadProfile()): Promise<MatchResult> {
  if (!API_KEY) throw new Error('Missing ZAI_API_KEY in environment/.env');

  const body = {
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(profile, job) },
    ],
    response_format: { type: 'json_object' },
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Z.AI ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? '';
      return parseResult(content);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  return { score: 0, reason: `scoring failed: ${(lastErr as Error)?.message ?? 'unknown'}` };
}

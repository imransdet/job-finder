import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JobRow } from './sheets';

// Z.AI (Zhipu GLM) — Anthropic-compatible endpoint. POST /v1/messages.
const BASE_URL = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/anthropic';
const MODEL = process.env.ZAI_MODEL || 'glm-5.2';
const API_KEY = process.env.ZAI_API_KEY;
const SCORE_TIMEOUT_MS = 15_000;

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
  'authorization, and the candidate\'s stated preferences. ' +
  'You MUST respond with ONLY a raw JSON object — no markdown, no code fences, no extra text. ' +
  'Format: {"score": <integer 0-100>, "reason": "<one or two sentences>"}';

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
    'Respond with the JSON object only.',
  ].join('\n');
}

function parseResult(content: string): MatchResult {
  // Strip markdown code fences if the model wraps the JSON despite instructions.
  const stripped = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const json = stripped.match(/\{[\s\S]*\}/)?.[0] ?? stripped;
  const obj = JSON.parse(json);
  const score = Math.max(0, Math.min(100, Math.round(Number(obj.score))));
  return { score: Number.isFinite(score) ? score : 0, reason: String(obj.reason ?? '').trim() };
}

type ContentBlock = { type: string; text?: string; thinking?: string };

/**
 * Extract the scoring text from an Anthropic-format response.
 * GLM-5 extended-thinking models sometimes emit only a "thinking" block with no
 * "text" block when max_tokens is tight. We prefer the text block; if absent,
 * we try to extract a JSON object from the thinking content as a fallback.
 */
function extractContent(data: unknown): string {
  const blocks = (data as { content?: ContentBlock[] })?.content;
  if (!Array.isArray(blocks)) return String((data as { content?: string })?.content ?? '');
  const textBlock = blocks.find((b) => b.type === 'text' && b.text);
  if (textBlock?.text) return textBlock.text;
  // Fallback: look for a JSON score object embedded inside the thinking block.
  const thinkingBlock = blocks.find((b) => b.type === 'thinking' && b.thinking);
  if (thinkingBlock?.thinking) {
    const match = thinkingBlock.thinking.match(/\{[^{}]*"score"[^{}]*\}/s);
    if (match) return match[0];
  }
  return '';
}

/**
 * Score a job against the candidate profile via Z.AI (Zhipu GLM).
 * Uses the Anthropic-compatible /v1/messages endpoint.
 * Retries 3 times; on persistent failure returns score 0 so the run continues.
 */
export async function scoreJob(job: JobRow, profile = loadProfile()): Promise<MatchResult> {
  if (!API_KEY) throw new Error('Missing ZAI_API_KEY in environment/.env');

  // Anthropic Messages API shape. max_tokens must be large enough for thinking + response.
  const body = {
    model: MODEL,
    max_tokens: 1500,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(profile, job) }],
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SCORE_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(`${BASE_URL}/v1/messages`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'x-api-key': API_KEY,
            Authorization: `Bearer ${API_KEY}`,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Z.AI ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = await res.json();
      const content = extractContent(data);
      if (!content) throw new Error(`Empty response from Z.AI: ${JSON.stringify(data).slice(0, 200)}`);
      return parseResult(content);
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message ?? '';
      console.log(`    [score attempt ${attempt}/3 failed] ${msg}`);
      // Don't retry on abort (timeout) — the API is clearly degraded right now.
      if (msg.includes('aborted') || msg.includes('abort')) break;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return { score: 0, reason: `scoring failed: ${(lastErr as Error)?.message ?? 'unknown'}` };
}

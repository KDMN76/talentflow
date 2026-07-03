/**
 * Deterministic mock-mode utilities shared by every RRR connector.
 *
 * Every connector under `connectors/*.ts` calls `inMockMode(integration)`
 * first; when true, it short-circuits the real HTTP path and returns
 * synthetic data seeded by the posting id so two calls in a row return
 * a *stable* but *advancing* applicants_count walk (covers the test
 * requirement: "advances applicants_count deterministically across two calls").
 */

import { createHash } from 'crypto';
import type { IntegrationCreds } from '../../types';

/**
 * True when env-var forces mock mode OR the integration has no real
 * credentials configured. Connectors call this BEFORE any axios import
 * so unit tests stay fully offline.
 *
 * Mirrors `isMockMode` in `../../types` but slightly more permissive: any
 * non-empty credential value qualifies as "real". QQQ's `isMockMode`
 * specifically looks for `access_token`/`api_key`; we delegate to QQQ
 * when both are absent and add the OAuth `client_secret` fallback used
 * by StepStone + Broadbean.
 *
 * PRODUCTIE-GUARD: in productie is mock-mode altijd uit — een posting zonder
 * echte credentials moet daar eerlijk falen in plaats van een synthetisch
 * 'posted' te faken.
 */
export function inMockMode(integration?: IntegrationCreds | null): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.JOB_BOARDS_MOCK === 'true') return true;
  if (!integration) return true;
  const creds = integration.credentials ?? {};
  const hasAnyCred = Object.values(creds).some((v) => typeof v === 'string' && v.length > 0);
  return !hasAnyCred;
}

/**
 * Hash a string to a stable integer in [0, 2^31).
 * Used as the deterministic seed for synthetic counters.
 */
export function seedFromString(s: string): number {
  const h = createHash('sha256').update(s).digest();
  // Read 4 bytes as unsigned int. `& 0x7fffffff` keeps it positive in JS.
  return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) & 0x7fffffff;
}

/**
 * Per-process counter used by the deterministic walk. Keyed by posting-id
 * so each posting advances independently; reset between test files via
 * `resetMockState()`.
 */
const callCounters = new Map<string, number>();

export function nextMockCallIndex(postingId: string): number {
  const cur = callCounters.get(postingId) ?? 0;
  const next = cur + 1;
  callCounters.set(postingId, next);
  return next;
}

export function resetMockState(): void {
  callCounters.clear();
}

/**
 * Deterministic "applicants count" that grows over time. Seed comes from
 * the posting id; increment comes from the per-process call counter.
 *
 *   Call 1 → seed % 5
 *   Call 2 → previous + (seed % 7) + 1
 *
 * Always strictly increasing within one process (test assertion friendly).
 */
export function mockApplicantsCount(postingId: string): number {
  const seed = seedFromString(postingId);
  const callIdx = nextMockCallIndex(postingId);
  // base + monotonic walk; +1 guarantees strict increase even if (seed % 7)
  // resolves to 0 for some posting ids.
  const base = seed % 5;
  const step = (seed % 7) + 1;
  return base + step * callIdx;
}

/**
 * Build a stable synthetic external_id of shape `<board>-<8-hex>`.
 * Same job-id always maps to same external_id — guarantees idempotency
 * for "post the same job twice" without DB lookup.
 */
export function mockExternalId(boardId: string, jobId: string): string {
  const seed = seedFromString(`${boardId}:${jobId}`);
  const hex = seed.toString(16).padStart(8, '0').slice(0, 8);
  return `${boardId}-${hex}`;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Standard mock expiry — 30 days from now() unless caller overrides.
 */
export function mockExpiresAt(now: Date = new Date(), days = 30): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export const MOCK_THIRTY_DAYS_MS = THIRTY_DAYS_MS;

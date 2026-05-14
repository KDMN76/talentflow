/**
 * Broadbean Multipost payload builder + sub-result aggregation.
 *
 * Broadbean is a "post once, fan-out to N boards" aggregator. Their
 * /jobs/post API accepts a single job description plus a `targets` array
 * naming the downstream boards. Each target returns its own response
 * (cost / external_id / status); we aggregate those when we surface a
 * single PostResult/StatusUpdate to the worker.
 *
 * Reference: https://www.broadbean.com/api/v1 (private docs, signed-NDA).
 * Below is the documented shape — fields names match Broadbean's public
 * sample-payloads in their integration handbook.
 */

import type { NormalizedJob, StatusUpdate } from '../../types';

/**
 * Wire-shape for a single Broadbean sub-board response.
 * Surfaced through `raw_response.results` on the stored posting.
 */
export interface BroadbeanSubResult {
  board: string;
  external_id?: string;
  external_url?: string;
  status: 'posted' | 'rejected' | 'expired' | 'retracted' | 'failed' | 'pending';
  cost_amount?: number | null;
  cost_currency?: string | null;
  applicants_count?: number;
  error?: string;
}

export interface BroadbeanPostBody {
  reference: string;
  title: string;
  description: string;
  location: {
    city?: string;
    country?: string;
    remote_policy?: string;
  };
  salary?: {
    min?: number;
    max?: number;
    currency?: string;
  };
  employment_type?: string;
  language?: string;
  apply_url?: string;
  targets: string[];
}

/**
 * Convert our NormalizedJob + selected target boards into the Broadbean
 * Multipost POST body. Optional fields are dropped when undefined to keep
 * the payload small (Broadbean rejects unknown null fields).
 */
export function mapToBroadbeanPayload(job: NormalizedJob, targets: string[]): BroadbeanPostBody {
  const body: BroadbeanPostBody = {
    reference: job.id,
    title: job.title,
    description: job.description,
    location: {},
    targets,
  };

  if (job.location) {
    if (job.location.city) body.location.city = job.location.city;
    if (job.location.country) body.location.country = job.location.country;
    if (job.location.remote_policy) body.location.remote_policy = job.location.remote_policy;
  }

  if (job.salary_min !== undefined || job.salary_max !== undefined) {
    body.salary = {
      ...(job.salary_min !== undefined ? { min: job.salary_min } : {}),
      ...(job.salary_max !== undefined ? { max: job.salary_max } : {}),
      ...(job.currency ? { currency: job.currency } : {}),
    };
  }

  if (job.employment_type) body.employment_type = job.employment_type;
  if (job.language) body.language = job.language;
  if (job.apply_url) body.apply_url = job.apply_url;

  return body;
}

/**
 * Sum sub-board costs. Returns `null` when ALL sub-boards report null cost
 * (fully organic distribution), otherwise the sum of all numeric values.
 */
export function aggregateBroadbeanCost(results: BroadbeanSubResult[]): {
  cost_amount: number | null;
  cost_currency: string | null;
} {
  const numeric = results.filter((r) => typeof r.cost_amount === 'number');
  if (numeric.length === 0) return { cost_amount: null, cost_currency: null };
  const total = numeric.reduce((acc, r) => acc + (r.cost_amount ?? 0), 0);
  // Pick the first currency we encounter; in practice Broadbean returns
  // a single currency for the whole multipost (recruiter's billing currency).
  const currency = numeric.find((r) => r.cost_currency)?.cost_currency ?? null;
  return { cost_amount: total, cost_currency: currency };
}

/**
 * Status precedence — "worst first" so we surface the most-actionable
 * status when sub-boards disagree:
 *   failed > rejected > expired > retracted > pending > posted
 *
 * Rationale: a recruiter looking at one aggregated row wants to be alerted
 * to ANY problem; "posted" only when ALL sub-boards succeeded.
 */
const STATUS_PRECEDENCE: Record<BroadbeanSubResult['status'], number> = {
  failed: 6,
  rejected: 5,
  expired: 4,
  retracted: 3,
  pending: 2,
  posted: 1,
};

export function worstStatus(results: BroadbeanSubResult[]): StatusUpdate['status'] {
  if (results.length === 0) return 'failed';
  let worst: BroadbeanSubResult['status'] = 'posted';
  for (const r of results) {
    if (STATUS_PRECEDENCE[r.status] > STATUS_PRECEDENCE[worst]) {
      worst = r.status;
    }
  }
  // Map "pending" — which is internal-Broadbean — to our "posted" enum.
  // Our StatusUpdate doesn't model "pending"; pending = still in flight,
  // so we report the prior state ("posted") and let the next poll pick up.
  if (worst === 'pending') return 'posted';
  return worst;
}

/**
 * Sum applicants across sub-boards. Missing values count as 0.
 */
export function aggregateApplicants(results: BroadbeanSubResult[]): number {
  return results.reduce((acc, r) => acc + (r.applicants_count ?? 0), 0);
}

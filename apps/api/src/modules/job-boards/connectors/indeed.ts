/**
 * Indeed connector — Sprint Q4.3.
 *
 * Authenticatie: API-key. Per-tenant `api_key` (Indeed Employer API token)
 * encrypted opgeslagen in `job_board_integrations.credentials_encrypted`.
 *
 * Endpoints (officieel — Indeed Employer API):
 *   - POST   https://employers.indeed.com/api/v2/jobs
 *   - GET    https://employers.indeed.com/api/v2/jobs/{external_id}
 *   - DELETE https://employers.indeed.com/api/v2/jobs/{external_id}
 *
 * Mock-mode mirror van LinkedIn — als geen api_key, retourneer synthetic
 * data zodat dev/demo werkt zonder live credentials. Standaard pricing:
 *   - organic = €0
 *   - sponsored = `settings.sponsored_cpc` × max applicants (default €0.50/apply)
 */

import axios, { type AxiosResponse } from 'axios';
import crypto from 'crypto';
import type {
  ConnectorContext,
  IntegrationCreds,
  JobBoardConnector,
  NormalizedJob,
  PostResult,
  PostingRef,
  StatusUpdate,
} from '../types';
import { isMockMode } from '../types';
import { JobBoardAuthError, mapHttpError } from './errors';
import { logger } from '../../../middleware/errorHandler';

const INDEED_API_BASE = 'https://employers.indeed.com/api/v2';

interface IndeedCreds {
  api_key?: string;
  account_id?: string;
}

function creds(integration: IntegrationCreds): IndeedCreds {
  return integration.credentials as IndeedCreds;
}

function buildIndeedPayload(
  job: NormalizedJob,
  integration: IntegrationCreds
): Record<string, unknown> {
  const settings = integration.settings as Record<string, unknown>;
  return {
    title: job.title,
    description: job.description,
    jobType: job.employment_type ?? 'full_time',
    location: {
      city: job.location?.city,
      country: job.location?.country ?? 'NL',
      remote: job.location?.remote_policy === 'remote',
    },
    salary: {
      min: job.salary_min,
      max: job.salary_max,
      currency: job.currency ?? 'EUR',
    },
    sponsored: settings.sponsored === true,
    cpc:
      typeof settings.sponsored_cpc === 'number'
        ? settings.sponsored_cpc
        : undefined,
    applyUrl: job.apply_url,
  };
}

function mockPost(
  _job: NormalizedJob,
  integration: IntegrationCreds
): PostResult {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const external_id = `indeed-mock-${id}`;
  const settings = integration.settings as Record<string, unknown>;
  const sponsored = settings.sponsored === true;
  const cpc =
    typeof settings.sponsored_cpc === 'number' ? settings.sponsored_cpc : 0.5;
  // Bij sponsored gaan we uit van een budget-cap van 50 clicks (zie settings).
  const budget =
    typeof settings.sponsored_budget === 'number'
      ? settings.sponsored_budget
      : 50;
  const cost = sponsored ? Number((cpc * budget).toFixed(2)) : 0;
  return {
    external_id,
    external_url: `https://employers.indeed.com/p/post/mock-${id}`,
    cost_amount: cost,
    cost_currency: 'EUR',
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    raw: { mock: true, sponsored, cpc },
  };
}

function mockPoll(posting: PostingRef): StatusUpdate {
  const seedHash = crypto.createHash('sha256').update(posting.id).digest();
  const base = (seedHash[1] ?? 0) % 4;
  const minuteBucket = Math.floor(Date.now() / 60_000) % 30;
  return {
    status: 'posted',
    applicants_count: Math.min(30, base + minuteBucket),
    raw: { mock: true, posting_id: posting.id },
  };
}

async function indeedRequest<T>(
  integration: IntegrationCreds,
  fn: (apiKey: string) => Promise<AxiosResponse<T>>
): Promise<AxiosResponse<T>> {
  const c = creds(integration);
  if (!c.api_key) {
    throw new JobBoardAuthError('Indeed api_key ontbreekt');
  }
  try {
    return await fn(c.api_key);
  } catch (err) {
    throw mapHttpError(err);
  }
}

export const indeedConnector: JobBoardConnector = {
  id: 'indeed',
  displayName: 'Indeed',
  region: 'global',
  authType: 'api_key',

  async post(_ctx, job, integration) {
    if (isMockMode(integration)) {
      logger.info('[jobBoards] Indeed post (mock)', { job_id: job.id });
      return mockPost(job, integration);
    }
    const payload = buildIndeedPayload(job, integration);
    const res = await indeedRequest(integration, (key) =>
      axios.post<{
        id: string;
        url?: string;
        expires_at?: string;
        cost?: number;
      }>(`${INDEED_API_BASE}/jobs`, payload, {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      })
    );
    return {
      external_id: res.data.id,
      external_url: res.data.url ?? null,
      cost_amount: res.data.cost ?? 0,
      cost_currency: 'EUR',
      expires_at: res.data.expires_at ?? null,
      raw: res.data,
    };
  },

  async pollStatus(_ctx, posting, integration) {
    if (isMockMode(integration)) {
      return mockPoll(posting);
    }
    if (!posting.external_id) return null;
    const res = await indeedRequest(integration, (key) =>
      axios.get<{ status?: string; applicants?: number }>(
        `${INDEED_API_BASE}/jobs/${posting.external_id}`,
        {
          headers: { Authorization: `Bearer ${key}` },
          timeout: 10_000,
        }
      )
    );
    const upstream = (res.data.status ?? 'active').toLowerCase();
    const status: StatusUpdate['status'] =
      upstream === 'expired'
        ? 'expired'
        : upstream === 'rejected' || upstream === 'denied'
          ? 'rejected'
          : 'posted';
    return {
      status,
      applicants_count: res.data.applicants ?? 0,
      raw: res.data,
    };
  },

  async retract(_ctx, posting, integration) {
    if (isMockMode(integration)) {
      logger.info('[jobBoards] Indeed retract (mock)', {
        posting_id: posting.id,
      });
      return;
    }
    if (!posting.external_id) return;
    await indeedRequest(integration, (key) =>
      axios.delete(`${INDEED_API_BASE}/jobs/${posting.external_id}`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 10_000,
      })
    );
  },
};

export default indeedConnector;

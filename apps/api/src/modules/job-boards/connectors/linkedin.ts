/**
 * LinkedIn connector — Sprint Q4.3.
 *
 * Authenticatie: OAuth 2.0 (3-legged). Per-tenant `access_token` +
 * `refresh_token` worden encrypted opgeslagen in
 * `job_board_integrations.credentials_encrypted`.
 *
 * Endpoints (officieel):
 *   - POST   https://api.linkedin.com/v2/simpleJobPostings
 *   - GET    https://api.linkedin.com/v2/simpleJobPostings/{id}
 *   - DELETE https://api.linkedin.com/v2/simpleJobPostings/{id}
 *   - POST   https://www.linkedin.com/oauth/v2/accessToken (refresh)
 *
 * Mock-mode is enabled wanneer `JOB_BOARDS_MOCK=true` of wanneer de tenant
 * geen geldige `access_token` heeft. Dan retourneren we deterministische
 * synthetic-data zodat dev/demo werkt zonder live API-toegang.
 */

import axios, { AxiosError, type AxiosResponse } from 'axios';
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
import {
  JobBoardAuthError,
  mapHttpError,
} from './errors';
import { logger } from '../../../middleware/errorHandler';

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';
const LINKEDIN_OAUTH_URL = 'https://www.linkedin.com/oauth/v2/accessToken';

interface LinkedInCreds {
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  organization_urn?: string;
  client_id?: string;
  client_secret?: string;
}

function creds(integration: IntegrationCreds): LinkedInCreds {
  return integration.credentials as LinkedInCreds;
}

/**
 * Map onze {@link NormalizedJob} naar het LinkedIn `simpleJobPostings`-payload.
 * LinkedIn vereist `companyApplyUrl` of `applyEmailAddress`. We zetten alleen
 * de minimale set + delegate description-rich-text naar plaintext fallback.
 */
function buildLinkedInPayload(
  job: NormalizedJob,
  integration: IntegrationCreds
): Record<string, unknown> {
  const c = creds(integration);
  const settings = integration.settings as Record<string, unknown>;
  const employmentMap: Record<string, string> = {
    full_time: 'FULL_TIME',
    part_time: 'PART_TIME',
    contract: 'CONTRACT',
    temporary: 'TEMPORARY',
    internship: 'INTERNSHIP',
  };
  return {
    integrationContext:
      c.organization_urn ?? (settings.organization_urn as string | undefined),
    title: job.title,
    description: { text: job.description },
    listingType: 'BASIC',
    workplaceTypes: [job.location?.remote_policy === 'remote' ? 'REMOTE' : 'ON_SITE'],
    employmentStatus: employmentMap[job.employment_type ?? 'full_time'],
    location: job.location?.city
      ? {
          country: job.location.country ?? 'NL',
          city: job.location.city,
        }
      : undefined,
    companyApplyUrl: job.apply_url,
  };
}

/**
 * Mock helper — bouwt deterministisch synthetic-data wanneer er geen live
 * credentials zijn. We gebruiken `crypto.randomUUID()` (geen ulid-dep nodig).
 */
function mockPost(job: NormalizedJob): PostResult {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const external_id = `linkedin-mock-${id}`;
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    external_id,
    external_url: `https://www.linkedin.com/jobs/view/mock-${id}/`,
    cost_amount: 49.0,
    cost_currency: 'EUR',
    expires_at: expires,
    raw: { mock: true, jobTitle: job.title },
  };
}

function mockPoll(posting: PostingRef): StatusUpdate {
  // Deterministische random op posting.id — applicants stijgen monotoon
  // per-poll dankzij timestamp-modifier, maar binnen dezelfde minuut
  // krijgen we een stabiel getal (handig voor tests).
  const seedHash = crypto.createHash('sha256').update(posting.id).digest();
  const base = (seedHash[0] ?? 0) % 5;
  const minuteBucket = Math.floor(Date.now() / 60_000) % 25;
  const applicants = Math.min(25, base + minuteBucket);
  return {
    status: 'posted',
    applicants_count: applicants,
    raw: { mock: true, posting_id: posting.id },
  };
}

/**
 * Voer een 401-aware request uit. Bij 401 proberen we precies één keer
 * de access-token te vernieuwen via refresh_token + retry.
 */
async function withTokenRefresh<T>(
  integration: IntegrationCreds,
  fn: (accessToken: string) => Promise<AxiosResponse<T>>
): Promise<AxiosResponse<T>> {
  const c = creds(integration);
  if (!c.access_token) {
    throw new JobBoardAuthError('LinkedIn access_token ontbreekt');
  }
  try {
    return await fn(c.access_token);
  } catch (err) {
    const ax = err as AxiosError;
    if (ax.response?.status === 401 && c.refresh_token) {
      logger.info('[jobBoards] LinkedIn 401 — refresh token + retry', {
        integration_id: integration.id,
      });
      const refreshed = await refreshAccessToken(integration);
      // mutate integration in-place — caller schrijft de nieuwe creds terug.
      (integration.credentials as LinkedInCreds).access_token =
        refreshed.access_token;
      if (refreshed.refresh_token) {
        (integration.credentials as LinkedInCreds).refresh_token =
          refreshed.refresh_token;
      }
      if (refreshed.expires_in) {
        (integration.credentials as LinkedInCreds).expires_at = new Date(
          Date.now() + refreshed.expires_in * 1000
        ).toISOString();
      }
      return await fn(refreshed.access_token);
    }
    throw mapHttpError(err);
  }
}

interface LinkedInTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

async function refreshAccessToken(
  integration: IntegrationCreds
): Promise<LinkedInTokenResponse> {
  const c = creds(integration);
  if (!c.refresh_token) {
    throw new JobBoardAuthError('LinkedIn refresh_token ontbreekt');
  }
  try {
    const res = await axios.post<LinkedInTokenResponse>(
      LINKEDIN_OAUTH_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: c.refresh_token,
        client_id: c.client_id ?? process.env.LINKEDIN_CLIENT_ID ?? '',
        client_secret:
          c.client_secret ?? process.env.LINKEDIN_CLIENT_SECRET ?? '',
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10_000,
      }
    );
    return res.data;
  } catch (err) {
    throw mapHttpError(err);
  }
}

export const linkedinConnector: JobBoardConnector = {
  id: 'linkedin',
  displayName: 'LinkedIn',
  region: 'global',
  authType: 'oauth2',

  async post(_ctx, job, integration) {
    if (isMockMode(integration)) {
      logger.info('[jobBoards] LinkedIn post (mock)', { job_id: job.id });
      return mockPost(job);
    }
    const payload = buildLinkedInPayload(job, integration);
    const res = await withTokenRefresh(integration, (token) =>
      axios.post<{ id: string; jobPostingUrl?: string; expiresAt?: string }>(
        `${LINKEDIN_API_BASE}/simpleJobPostings`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Restli-Protocol-Version': '2.0.0',
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        }
      )
    );
    return {
      external_id: res.data.id,
      external_url: res.data.jobPostingUrl ?? null,
      cost_amount: 49.0,
      cost_currency: 'EUR',
      expires_at: res.data.expiresAt ?? null,
      raw: res.data,
    };
  },

  async pollStatus(_ctx, posting, integration) {
    if (isMockMode(integration)) {
      return mockPoll(posting);
    }
    if (!posting.external_id) return null;
    const res = await withTokenRefresh(integration, (token) =>
      axios.get<{
        lifecycleState?: string;
        applicantCount?: number;
      }>(`${LINKEDIN_API_BASE}/simpleJobPostings/${posting.external_id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        timeout: 10_000,
      })
    );
    const lifecycle = res.data.lifecycleState ?? 'PUBLISHED';
    const status: StatusUpdate['status'] =
      lifecycle === 'CLOSED'
        ? 'expired'
        : lifecycle === 'REJECTED'
          ? 'rejected'
          : 'posted';
    return {
      status,
      applicants_count: res.data.applicantCount ?? 0,
      raw: res.data,
    };
  },

  async retract(_ctx, posting, integration) {
    if (isMockMode(integration)) {
      logger.info('[jobBoards] LinkedIn retract (mock)', {
        posting_id: posting.id,
      });
      return;
    }
    if (!posting.external_id) return;
    await withTokenRefresh(integration, (token) =>
      axios.delete(
        `${LINKEDIN_API_BASE}/simpleJobPostings/${posting.external_id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Restli-Protocol-Version': '2.0.0',
          },
          timeout: 10_000,
        }
      )
    );
  },
};

export default linkedinConnector;

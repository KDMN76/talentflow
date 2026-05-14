/**
 * StepStone connector — `oauth2`, region: eu (covers DE + NL).
 *
 * Endpoint: https://api.stepstone.com/v1/job-postings
 * Auth:     OAuth2 client_credentials grant against the StepStone
 *           Recruiter API. Tokens cached in `integration.credentials` and
 *           refreshed transparently when within `REFRESH_BUFFER_MS` of expiry.
 *
 * The refresh path mirrors `modules/integrations/mailbox.service.ts` —
 * caller passes the integration row, we mutate `credentials.access_token`
 * and `credentials.expires_at` and return the same row. Persistence is the
 * shared service's responsibility (QQQ owns service.ts).
 *
 * Cost: settings.posting_fee_eur (default 250 EUR per posting).
 */

import axios, { type AxiosError } from 'axios';
import type {
  ConnectorContext,
  IntegrationCreds,
  JobBoardConnector,
  NormalizedJob,
  PostResult,
  PostingRef,
  StatusUpdate,
} from '../types';
import {
  inMockMode,
  mockApplicantsCount,
  mockExpiresAt,
  mockExternalId,
} from './_helpers/mock.helper';
import { JobBoardAuthError, mapHttpError } from './errors';

const BOARD_ID = 'stepstone';
const BASE_URL = 'https://api.stepstone.com/v1';
const TOKEN_URL = 'https://api.stepstone.com/oauth/token';
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_FEE_EUR = 250;

interface StepStoneCredentials {
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  expires_at?: string; // ISO
}

interface StepStoneSettings {
  posting_fee_eur?: number;
  posting_duration_days?: number;
  country?: 'DE' | 'NL';
}

/**
 * Refresh the OAuth client_credentials access token if it's missing or
 * close to expiry. Mutates `integration.credentials` in place AND returns
 * the new token so callers can persist it.
 */
async function ensureFreshToken(integration: IntegrationCreds): Promise<string> {
  const creds = (integration.credentials ?? {}) as StepStoneCredentials;
  const now = Date.now();
  const expiresAt = creds.expires_at ? new Date(creds.expires_at).getTime() : 0;
  if (creds.access_token && expiresAt > now + REFRESH_BUFFER_MS) {
    return creds.access_token;
  }

  if (!creds.client_id || !creds.client_secret) {
    throw new JobBoardAuthError('StepStone credentials missing (client_id/client_secret)');
  }

  try {
    const { data } = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        scope: 'job-postings:write job-postings:read',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 }
    );
    const accessToken = String(data.access_token);
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    integration.credentials = {
      ...creds,
      access_token: accessToken,
      expires_at: new Date(now + expiresIn * 1000).toISOString(),
    };
    return accessToken;
  } catch (err) {
    throw mapHttpError(err as AxiosError);
  }
}

function buildPayload(job: NormalizedJob, settings: StepStoneSettings): Record<string, unknown> {
  return {
    reference: job.id,
    title: job.title,
    description: job.description,
    location: {
      city: job.location?.city,
      country: job.location?.country ?? settings.country ?? 'DE',
      remote_policy: job.location?.remote_policy,
    },
    salary: {
      min: job.salary_min,
      max: job.salary_max,
      currency: job.currency ?? 'EUR',
    },
    employment_type: job.employment_type,
    language: job.language ?? 'de',
    apply_url: job.apply_url,
    duration_days: settings.posting_duration_days ?? 30,
  };
}

export const stepstoneConnector: JobBoardConnector = {
  id: BOARD_ID,
  displayName: 'StepStone',
  region: 'eu',
  authType: 'oauth2',

  async post(_ctx: ConnectorContext, job: NormalizedJob, integration: IntegrationCreds): Promise<PostResult> {
    const settings = (integration.settings ?? {}) as StepStoneSettings;
    const fee = settings.posting_fee_eur ?? DEFAULT_FEE_EUR;
    const days = settings.posting_duration_days ?? 30;

    if (inMockMode(integration)) {
      const externalId = mockExternalId(BOARD_ID, job.id);
      return {
        external_id: externalId,
        external_url: `https://www.stepstone.${settings.country === 'NL' ? 'nl' : 'de'}/stellenangebote--${externalId}`,
        cost_amount: fee,
        cost_currency: 'EUR',
        expires_at: mockExpiresAt(new Date(), days),
        raw: { mock: true, board: BOARD_ID, payload: buildPayload(job, settings) },
      };
    }

    const token = await ensureFreshToken(integration);
    try {
      const { data } = await axios.post(`${BASE_URL}/job-postings`, buildPayload(job, settings), {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15_000,
      });
      return {
        external_id: String(data.id ?? ''),
        external_url: data.public_url ?? null,
        cost_amount: fee,
        cost_currency: 'EUR',
        expires_at: data.expires_at ?? mockExpiresAt(new Date(), days),
        raw: data,
      };
    } catch (err) {
      throw mapHttpError(err as AxiosError);
    }
  },

  async pollStatus(
    _ctx: ConnectorContext,
    posting: PostingRef,
    integration: IntegrationCreds
  ): Promise<StatusUpdate | null> {
    if (inMockMode(integration)) {
      return {
        status: 'posted',
        applicants_count: mockApplicantsCount(posting.id),
        raw: { mock: true, board: BOARD_ID, posting_id: posting.id },
      };
    }
    if (!posting.external_id) return null;
    const token = await ensureFreshToken(integration);
    try {
      const { data } = await axios.get(`${BASE_URL}/job-postings/${posting.external_id}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10_000,
      });
      return {
        status: data.status === 'expired' ? 'expired' : 'posted',
        applicants_count: typeof data.applicants_count === 'number' ? data.applicants_count : 0,
        raw: data,
      };
    } catch (err) {
      throw mapHttpError(err as AxiosError);
    }
  },

  async retract(_ctx: ConnectorContext, posting: PostingRef, integration: IntegrationCreds): Promise<void> {
    if (inMockMode(integration)) return;
    if (!posting.external_id) return;
    const token = await ensureFreshToken(integration);
    try {
      await axios.delete(`${BASE_URL}/job-postings/${posting.external_id}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10_000,
      });
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status === 404) return; // idempotent
      throw mapHttpError(err as AxiosError);
    }
  },
};

export default stepstoneConnector;

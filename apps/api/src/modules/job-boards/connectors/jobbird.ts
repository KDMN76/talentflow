/**
 * Jobbird connector — `api_key`, region: nl.
 *
 * Endpoint: POST https://api.jobbird.com/v1/jobs (Bearer api_key).
 * Status:    GET  https://api.jobbird.com/v1/jobs/{id}
 * Retract:   DELETE /v1/jobs/{id}
 *
 * Pricing:
 *   - settings.product = 'organic' → € 0
 *   - settings.product = 'sponsored' → daily_sponsored_rate_eur × posting_duration_days
 *     (defaults: 4 €/day × 30 days = €120 unless overridden)
 *
 * The first non-401/403 4xx is mapped to JobBoardClientError so the worker
 * does NOT retry transparently — the recruiter must fix the payload.
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
import { mapHttpError } from './errors';

const BOARD_ID = 'jobbird';
const BASE_URL = 'https://api.jobbird.com/v1';

interface JobbirdSettings {
  product?: 'organic' | 'sponsored';
  daily_sponsored_rate_eur?: number;
  posting_duration_days?: number;
}

function calcCost(settings: JobbirdSettings): number {
  if (settings.product !== 'sponsored') return 0;
  const rate = typeof settings.daily_sponsored_rate_eur === 'number' ? settings.daily_sponsored_rate_eur : 4;
  const days = typeof settings.posting_duration_days === 'number' ? settings.posting_duration_days : 30;
  return rate * days;
}

function buildPayload(job: NormalizedJob): Record<string, unknown> {
  return {
    title: job.title,
    description_html: job.description,
    location_city: job.location?.city,
    location_country: job.location?.country,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    currency: job.currency ?? 'EUR',
    contract_type: job.employment_type,
    apply_url: job.apply_url,
    language: job.language ?? 'nl',
    reference: job.id,
  };
}

export const jobbirdConnector: JobBoardConnector = {
  id: BOARD_ID,
  displayName: 'Jobbird',
  region: 'nl',
  authType: 'api_key',

  async post(_ctx: ConnectorContext, job: NormalizedJob, integration: IntegrationCreds): Promise<PostResult> {
    const settings = (integration.settings ?? {}) as JobbirdSettings;
    const cost = calcCost(settings);

    if (inMockMode(integration)) {
      const externalId = mockExternalId(BOARD_ID, job.id);
      return {
        external_id: externalId,
        external_url: `https://www.jobbird.com/nl/vacature/${externalId}`,
        cost_amount: cost,
        cost_currency: 'EUR',
        expires_at: mockExpiresAt(new Date(), settings.posting_duration_days ?? 30),
        raw: { mock: true, board: BOARD_ID, payload: buildPayload(job) },
      };
    }

    // TODO(real-api): real production path — verified against Jobbird docs.
    const apiKey = (integration.credentials?.api_key as string | undefined) ?? '';
    try {
      const { data } = await axios.post(
        `${BASE_URL}/jobs`,
        { ...buildPayload(job), product: settings.product ?? 'organic' },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15_000 }
      );
      return {
        external_id: String(data.id ?? data.external_id ?? ''),
        external_url: data.public_url ?? null,
        cost_amount: cost,
        cost_currency: 'EUR',
        expires_at: data.expires_at ?? mockExpiresAt(new Date(), settings.posting_duration_days ?? 30),
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
    const apiKey = (integration.credentials?.api_key as string | undefined) ?? '';
    try {
      const { data } = await axios.get(`${BASE_URL}/jobs/${posting.external_id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
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
    const apiKey = (integration.credentials?.api_key as string | undefined) ?? '';
    try {
      await axios.delete(`${BASE_URL}/jobs/${posting.external_id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10_000,
      });
    } catch (err) {
      // 404 = already gone — idempotent retract.
      const status = (err as AxiosError).response?.status;
      if (status === 404) return;
      throw mapHttpError(err as AxiosError);
    }
  },
};

export default jobbirdConnector;

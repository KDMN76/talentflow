/**
 * Jobs.nl connector — `api_key`, region: nl.
 *
 * Endpoint: POST https://api.jobs.nl/v1/job-listings (Bearer api_key).
 * Cost: flat €40 per post (override via settings.flat_fee_eur).
 *
 * Same general shape as Jobbird/Werkzoeken — slim payload, simple poll +
 * delete endpoints. Documentation differs in field names which we map below.
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

const BOARD_ID = 'jobsnl';
const BASE_URL = 'https://api.jobs.nl/v1';
const DEFAULT_FEE_EUR = 40;

interface JobsnlSettings {
  flat_fee_eur?: number;
  posting_duration_days?: number;
}

function buildPayload(job: NormalizedJob): Record<string, unknown> {
  return {
    external_reference: job.id,
    job_title: job.title,
    job_description: job.description,
    work_city: job.location?.city,
    work_country: job.location?.country ?? 'NL',
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    salary_currency: job.currency ?? 'EUR',
    contract: job.employment_type,
    apply_link: job.apply_url,
    locale: job.language ?? 'nl',
  };
}

export const jobsnlConnector: JobBoardConnector = {
  id: BOARD_ID,
  displayName: 'Jobs.nl',
  region: 'nl',
  authType: 'api_key',

  async post(_ctx: ConnectorContext, job: NormalizedJob, integration: IntegrationCreds): Promise<PostResult> {
    const settings = (integration.settings ?? {}) as JobsnlSettings;
    const fee = settings.flat_fee_eur ?? DEFAULT_FEE_EUR;
    const days = settings.posting_duration_days ?? 30;

    if (inMockMode(integration)) {
      const externalId = mockExternalId(BOARD_ID, job.id);
      return {
        external_id: externalId,
        external_url: `https://www.jobs.nl/vacature/${externalId}`,
        cost_amount: fee,
        cost_currency: 'EUR',
        expires_at: mockExpiresAt(new Date(), days),
        raw: { mock: true, board: BOARD_ID, payload: buildPayload(job) },
      };
    }

    const apiKey = (integration.credentials?.api_key as string | undefined) ?? '';
    try {
      const { data } = await axios.post(`${BASE_URL}/job-listings`, buildPayload(job), {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15_000,
      });
      return {
        external_id: String(data.listing_id ?? data.id ?? ''),
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
    const apiKey = (integration.credentials?.api_key as string | undefined) ?? '';
    try {
      const { data } = await axios.get(`${BASE_URL}/job-listings/${posting.external_id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10_000,
      });
      return {
        status: data.lifecycle === 'expired' ? 'expired' : 'posted',
        applicants_count: typeof data.application_count === 'number' ? data.application_count : 0,
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
      await axios.delete(`${BASE_URL}/job-listings/${posting.external_id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10_000,
      });
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status === 404) return;
      throw mapHttpError(err as AxiosError);
    }
  },
};

export default jobsnlConnector;

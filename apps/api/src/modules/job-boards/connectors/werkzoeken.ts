/**
 * Werkzoeken.nl connector — `api_key`, region: nl.
 *
 * Endpoint: POST https://api.werkzoeken.nl/v2/postings
 * Auth header: `X-API-Key: <key>`.
 * Cost: flat €60 per post (override via settings.flat_fee_eur).
 *
 * Werkzoeken's API is documented as "thin" — they expect title + html body
 * + city + apply_url and ignore unknown fields. Polling returns a single
 * `applicants` integer.
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

const BOARD_ID = 'werkzoeken';
const BASE_URL = 'https://api.werkzoeken.nl/v2';
const DEFAULT_FEE_EUR = 60;

interface WerkzoekenSettings {
  flat_fee_eur?: number;
  posting_duration_days?: number;
}

function buildPayload(job: NormalizedJob): Record<string, unknown> {
  return {
    reference: job.id,
    title: job.title,
    body_html: job.description,
    city: job.location?.city,
    apply_url: job.apply_url,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    contract_type: job.employment_type,
  };
}

export const werkzoekenConnector: JobBoardConnector = {
  id: BOARD_ID,
  displayName: 'Werkzoeken.nl',
  region: 'nl',
  authType: 'api_key',

  async post(_ctx: ConnectorContext, job: NormalizedJob, integration: IntegrationCreds): Promise<PostResult> {
    const settings = (integration.settings ?? {}) as WerkzoekenSettings;
    const fee = settings.flat_fee_eur ?? DEFAULT_FEE_EUR;
    const days = settings.posting_duration_days ?? 30;

    if (inMockMode(integration)) {
      const externalId = mockExternalId(BOARD_ID, job.id);
      return {
        external_id: externalId,
        external_url: `https://www.werkzoeken.nl/vacature/${externalId}`,
        cost_amount: fee,
        cost_currency: 'EUR',
        expires_at: mockExpiresAt(new Date(), days),
        raw: { mock: true, board: BOARD_ID, payload: buildPayload(job) },
      };
    }

    const apiKey = (integration.credentials?.api_key as string | undefined) ?? '';
    try {
      const { data } = await axios.post(`${BASE_URL}/postings`, buildPayload(job), {
        headers: { 'X-API-Key': apiKey },
        timeout: 15_000,
      });
      return {
        external_id: String(data.id ?? ''),
        external_url: data.url ?? null,
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
      const { data } = await axios.get(`${BASE_URL}/postings/${posting.external_id}`, {
        headers: { 'X-API-Key': apiKey },
        timeout: 10_000,
      });
      return {
        status: data.state === 'closed' ? 'expired' : 'posted',
        applicants_count: typeof data.applicants === 'number' ? data.applicants : 0,
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
      await axios.delete(`${BASE_URL}/postings/${posting.external_id}`, {
        headers: { 'X-API-Key': apiKey },
        timeout: 10_000,
      });
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status === 404) return;
      throw mapHttpError(err as AxiosError);
    }
  },
};

export default werkzoekenConnector;

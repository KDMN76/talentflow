/**
 * Broadbean Multipost connector — `oauth2`, region: global.
 *
 * Endpoint: POST https://www.broadbean.com/api/v1/jobs/post
 * Auth:     OAuth2 client_credentials.
 *
 * Broadbean is a fan-out aggregator: one POST distributes the same job to
 * N downstream boards listed in `settings.target_boards`. The sub-results
 * come back in the response under `results[]`. We:
 *
 *   - Sum costs across sub-boards (null when all are organic)
 *   - Take the worst status as our aggregate (see broadbean.helper)
 *   - Sum applicants across sub-boards on poll
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
  seedFromString,
} from './_helpers/mock.helper';
import { JobBoardAuthError, mapHttpError } from './errors';
import {
  aggregateApplicants,
  aggregateBroadbeanCost,
  mapToBroadbeanPayload,
  worstStatus,
  type BroadbeanSubResult,
} from './_helpers/broadbean.helper';

const BOARD_ID = 'broadbean';
const BASE_URL = 'https://www.broadbean.com/api/v1';
const TOKEN_URL = 'https://www.broadbean.com/api/oauth/token';
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface BroadbeanCredentials {
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  expires_at?: string;
}

interface BroadbeanSettings {
  target_boards?: string[];
  posting_duration_days?: number;
}

async function ensureFreshToken(integration: IntegrationCreds): Promise<string> {
  const creds = (integration.credentials ?? {}) as BroadbeanCredentials;
  const now = Date.now();
  const expiresAt = creds.expires_at ? new Date(creds.expires_at).getTime() : 0;
  if (creds.access_token && expiresAt > now + REFRESH_BUFFER_MS) {
    return creds.access_token;
  }
  if (!creds.client_id || !creds.client_secret) {
    throw new JobBoardAuthError('Broadbean credentials missing (client_id/client_secret)');
  }
  try {
    const { data } = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.client_id,
        client_secret: creds.client_secret,
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

/**
 * Build a deterministic synthetic sub-result list seeded by job-id.
 * Used in mock-mode + as fallback when Broadbean's response is malformed.
 *
 * Each sub-board reports cost = floor((seed XOR boardHash) % 50) EUR so
 * tests can assert the aggregation is non-zero & currency='EUR'.
 */
function buildMockSubResults(jobOrPostingId: string, targets: string[]): BroadbeanSubResult[] {
  if (targets.length === 0) return [];
  const baseSeed = seedFromString(jobOrPostingId);
  return targets.map((board, idx) => {
    const seed = seedFromString(`${jobOrPostingId}:${board}`);
    const cost = (baseSeed + seed) % 50; // 0–49 EUR per sub-board
    return {
      board,
      external_id: `${board}-${seed.toString(16).slice(0, 8)}`,
      external_url: `https://broadbean.example/${board}/${seed.toString(16).slice(0, 8)}`,
      status: 'posted',
      cost_amount: cost,
      cost_currency: 'EUR',
      applicants_count: idx, // stable per-target offset
    };
  });
}

export const broadbeanConnector: JobBoardConnector = {
  id: BOARD_ID,
  displayName: 'Broadbean Multipost',
  region: 'global',
  authType: 'oauth2',

  async post(_ctx: ConnectorContext, job: NormalizedJob, integration: IntegrationCreds): Promise<PostResult> {
    const settings = (integration.settings ?? {}) as BroadbeanSettings;
    const targets = settings.target_boards ?? [];
    const days = settings.posting_duration_days ?? 30;

    if (inMockMode(integration)) {
      const subResults = buildMockSubResults(job.id, targets);
      const { cost_amount, cost_currency } = aggregateBroadbeanCost(subResults);
      const externalId = mockExternalId(BOARD_ID, job.id);
      return {
        external_id: externalId,
        external_url: `https://www.broadbean.com/multipost/${externalId}`,
        cost_amount,
        cost_currency,
        expires_at: mockExpiresAt(new Date(), days),
        raw: {
          mock: true,
          board: BOARD_ID,
          payload: mapToBroadbeanPayload(job, targets),
          results: subResults,
        },
      };
    }

    const token = await ensureFreshToken(integration);
    try {
      const { data } = await axios.post(`${BASE_URL}/jobs/post`, mapToBroadbeanPayload(job, targets), {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20_000,
      });
      const subResults: BroadbeanSubResult[] = Array.isArray(data.results) ? data.results : [];
      const { cost_amount, cost_currency } = aggregateBroadbeanCost(subResults);
      return {
        external_id: String(data.multipost_id ?? data.id ?? ''),
        external_url: data.public_url ?? null,
        cost_amount,
        cost_currency,
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
    const settings = (integration.settings ?? {}) as BroadbeanSettings;
    const targets = settings.target_boards ?? [];

    if (inMockMode(integration)) {
      // Deterministic walk seeded by posting.id — every sub-board's count
      // grows by mockApplicantsCount(posting.id) split across them.
      const total = mockApplicantsCount(posting.id);
      const subResults: BroadbeanSubResult[] = targets.length
        ? targets.map((board, idx) => ({
            board,
            status: 'posted',
            applicants_count: Math.floor(total / targets.length) + (idx < total % targets.length ? 1 : 0),
          }))
        : [{ board: 'unknown', status: 'posted', applicants_count: total }];
      return {
        status: worstStatus(subResults),
        applicants_count: aggregateApplicants(subResults),
        raw: { mock: true, board: BOARD_ID, posting_id: posting.id, results: subResults },
      };
    }

    if (!posting.external_id) return null;
    const token = await ensureFreshToken(integration);
    try {
      const { data } = await axios.get(`${BASE_URL}/jobs/${posting.external_id}/status`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10_000,
      });
      const subResults: BroadbeanSubResult[] = Array.isArray(data.results) ? data.results : [];
      return {
        status: worstStatus(subResults),
        applicants_count: aggregateApplicants(subResults),
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
      await axios.delete(`${BASE_URL}/jobs/${posting.external_id}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10_000,
      });
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status === 404) return;
      throw mapHttpError(err as AxiosError);
    }
  },
};

export default broadbeanConnector;

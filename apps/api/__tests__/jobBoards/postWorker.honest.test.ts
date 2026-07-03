/**
 * Job-board post-gedrag — "geen fake 'posted'" (Q-hardening).
 *
 * Vóór de fix draaide elke connector zonder echte credentials in mock-mode,
 * óók in productie: een plaatsing kreeg dan een synthetisch external_id en
 * status 'posted' terwijl er nooit iets op het board stond.
 *
 * Deze tests pinnen vast:
 *   1. isMockMode / mock-mode is in productie ALTIJD uit (ook met
 *      JOB_BOARDS_MOCK=true en ook zonder credentials).
 *   2. De post-worker markeert een niet-geconfigureerd board in productie
 *      direct als 'failed' met een duidelijke NL-melding — zonder de
 *      connector aan te roepen en zonder BullMQ-retry.
 *   3. Buiten productie blijft het mock-pad werken (dev/demo/tests).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';

const { loadSpy, failSpy, resultSpy } = vi.hoisted(() => ({
  loadSpy: vi.fn(),
  failSpy: vi.fn(async () => undefined),
  resultSpy: vi.fn(async () => undefined),
}));

vi.mock('../../src/modules/job-boards/service', () => ({
  loadPostingForPost: loadSpy,
  applyPostFailure: failSpy,
  applyPostResult: resultSpy,
}));

import {
  processPostJob,
  NOT_CONFIGURED_MESSAGE,
  type JobBoardPostJobData,
} from '../../src/queue/workers/jobBoardPost.worker';
import {
  isMockMode,
  mockPostingsAllowed,
  hasRealCredentials,
  type IntegrationCreds,
  type JobBoardConnector,
} from '../../src/modules/job-boards/types';
import { inMockMode } from '../../src/modules/job-boards/connectors/_helpers/mock.helper';

const TENANT = '11111111-1111-1111-1111-111111111111';
const POSTING_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_MOCK_FLAG = process.env.JOB_BOARDS_MOCK;

function fakeJob(): Job<JobBoardPostJobData> {
  return {
    id: 'test-job',
    data: { tenantId: TENANT, postingId: POSTING_ID, boardId: 'linkedin' },
  } as unknown as Job<JobBoardPostJobData>;
}

function emptyCreds(): IntegrationCreds {
  return {
    id: 'no-integration',
    tenant_id: TENANT,
    settings: {},
    credentials: {},
  };
}

function realCreds(): IntegrationCreds {
  return {
    id: 'integ-1',
    tenant_id: TENANT,
    settings: {},
    credentials: { access_token: 'live-token-1234567890' },
  };
}

function fakeConnector(post: JobBoardConnector['post']): JobBoardConnector {
  return {
    id: 'linkedin',
    displayName: 'LinkedIn',
    region: 'global',
    authType: 'oauth2',
    post,
    pollStatus: vi.fn(async () => null),
    retract: vi.fn(async () => undefined),
  };
}

function basePosting() {
  return {
    id: POSTING_ID,
    tenant_id: TENANT,
    job_id: 'job-1',
    board_id: 'linkedin',
    integration_id: null,
    external_id: null,
    external_url: null,
    status: 'queued',
    posted_at: null,
    expires_at: null,
    retracted_at: null,
    cost_amount: null,
    cost_currency: 'EUR',
    applicants_count: 0,
    last_polled_at: null,
    metadata: {},
    error_message: null,
    created_by: null,
    created_at: new Date().toISOString(),
  };
}

const normalizedJob = {
  id: 'job-1',
  title: 'Senior Backend Engineer',
  description: 'Bouw mee aan TalentFlow.',
};

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_MOCK_FLAG === undefined) delete process.env.JOB_BOARDS_MOCK;
  else process.env.JOB_BOARDS_MOCK = ORIGINAL_MOCK_FLAG;
});

beforeEach(() => {
  loadSpy.mockReset();
  failSpy.mockClear();
  resultSpy.mockClear();
});

describe('mock-mode gating', () => {
  it('in productie is mock-mode uit — ook zonder credentials', () => {
    process.env.NODE_ENV = 'production';
    expect(mockPostingsAllowed()).toBe(false);
    expect(isMockMode(null)).toBe(false);
    expect(isMockMode(emptyCreds())).toBe(false);
    expect(inMockMode(emptyCreds())).toBe(false);
  });

  it('in productie wint de guard óók van JOB_BOARDS_MOCK=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.JOB_BOARDS_MOCK = 'true';
    expect(isMockMode(emptyCreds())).toBe(false);
    expect(inMockMode(emptyCreds())).toBe(false);
  });

  it('buiten productie blijft mock-mode beschikbaar zonder credentials', () => {
    process.env.NODE_ENV = 'test';
    expect(mockPostingsAllowed()).toBe(true);
    expect(isMockMode(emptyCreds())).toBe(true);
    expect(isMockMode(realCreds())).toBe(false);
  });

  it('hasRealCredentials herkent tokens en api-keys', () => {
    expect(hasRealCredentials(emptyCreds())).toBe(false);
    expect(hasRealCredentials(realCreds())).toBe(true);
    expect(hasRealCredentials(null)).toBe(false);
  });
});

describe('processPostJob — eerlijk post-gedrag', () => {
  it('productie + geen credentials → failed met NL-melding, connector niet aangeroepen', async () => {
    process.env.NODE_ENV = 'production';
    const postSpy = vi.fn();
    loadSpy.mockResolvedValue({
      posting: basePosting(),
      job: normalizedJob,
      connector: fakeConnector(postSpy),
      creds: emptyCreds(),
    });

    const outcome = await processPostJob(fakeJob());

    expect(outcome).toMatchObject({ failed: true, reason: 'not_configured' });
    expect(postSpy).not.toHaveBeenCalled();
    expect(resultSpy).not.toHaveBeenCalled();
    expect(failSpy).toHaveBeenCalledWith(
      TENANT,
      POSTING_ID,
      NOT_CONFIGURED_MESSAGE
    );
    // De melding is Nederlands en verwijst naar de oplossing.
    expect(NOT_CONFIGURED_MESSAGE).toMatch(/niet gekoppeld/i);
    expect(NOT_CONFIGURED_MESSAGE).toMatch(/Verbind het board/i);
  });

  it('buiten productie: mock-connector post → applyPostResult (dev/demo blijft werken)', async () => {
    process.env.NODE_ENV = 'test';
    const mockResult = {
      external_id: 'linkedin-mock-abc123',
      external_url: 'https://www.linkedin.com/jobs/view/mock-abc123/',
      cost_amount: 49.0,
      cost_currency: 'EUR',
      expires_at: null,
      raw: { mock: true },
    };
    const postSpy = vi.fn(async () => mockResult);
    loadSpy.mockResolvedValue({
      posting: basePosting(),
      job: normalizedJob,
      connector: fakeConnector(postSpy),
      creds: emptyCreds(),
    });

    const outcome = await processPostJob(fakeJob());

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(resultSpy).toHaveBeenCalledWith(TENANT, POSTING_ID, mockResult);
    expect(failSpy).not.toHaveBeenCalled();
    expect(outcome).toBe(mockResult);
  });

  it('productie + echte credentials: connector-fout → failed + re-throw (BullMQ retry)', async () => {
    process.env.NODE_ENV = 'production';
    const postSpy = vi.fn(async () => {
      throw new Error('LinkedIn API 500');
    });
    loadSpy.mockResolvedValue({
      posting: basePosting(),
      job: normalizedJob,
      connector: fakeConnector(postSpy),
      creds: realCreds(),
    });

    await expect(processPostJob(fakeJob())).rejects.toThrow('LinkedIn API 500');
    expect(failSpy).toHaveBeenCalledWith(TENANT, POSTING_ID, 'LinkedIn API 500');
    expect(resultSpy).not.toHaveBeenCalled();
  });

  it('onbekende connector → failed', async () => {
    process.env.NODE_ENV = 'production';
    loadSpy.mockResolvedValue({
      posting: basePosting(),
      job: normalizedJob,
      connector: null,
      creds: realCreds(),
    });

    await expect(processPostJob(fakeJob())).rejects.toThrow(/Onbekende connector/);
    expect(failSpy).toHaveBeenCalled();
  });
});

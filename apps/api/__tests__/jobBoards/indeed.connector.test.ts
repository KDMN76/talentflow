import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('axios');
import axios from 'axios';

import { indeedConnector } from '../../src/modules/job-boards/connectors/indeed';
import type {
  ConnectorContext,
  IntegrationCreds,
  NormalizedJob,
  PostingRef,
} from '../../src/modules/job-boards/types';

const TENANT = '22222222-2222-2222-2222-222222222222';
const ctx: ConnectorContext = { tenantId: TENANT, userId: null };

const job: NormalizedJob = {
  id: 'job-1',
  title: 'Recruiter',
  description: 'Werk in een hecht team.',
  employment_type: 'full_time',
  location: { city: 'Den Haag', country: 'NL' },
};

function creds(real = false, settings: Record<string, unknown> = {}): IntegrationCreds {
  return {
    id: 'integ-2',
    tenant_id: TENANT,
    settings,
    credentials: real
      ? { api_key: 'indeed-real-key-xxxxxxxxx' }
      : {},
  };
}

describe('indeedConnector — mock-mode', () => {
  beforeEach(() => {
    process.env.JOB_BOARDS_MOCK = 'true';
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.JOB_BOARDS_MOCK;
  });

  it('post() returns mock external_id with €0 cost when not sponsored', async () => {
    const result = await indeedConnector.post(ctx, job, creds());
    expect(result.external_id).toMatch(/^indeed-mock-/);
    expect(result.external_url).toMatch(/indeed\.com/);
    expect(result.cost_amount).toBe(0);
  });

  it('post() applies sponsored CPC × budget when sponsored=true', async () => {
    const result = await indeedConnector.post(
      ctx,
      job,
      creds(false, { sponsored: true, sponsored_cpc: 0.5, sponsored_budget: 50 })
    );
    expect(result.cost_amount).toBeCloseTo(25.0, 2);
  });

  it('pollStatus() returns posted + bounded applicants_count', async () => {
    const posting: PostingRef = {
      id: 'p-2',
      external_id: 'indeed-mock-x',
      tenant_id: TENANT,
    };
    const update = await indeedConnector.pollStatus(ctx, posting, creds());
    expect(update?.status).toBe('posted');
    expect(update?.applicants_count).toBeGreaterThanOrEqual(0);
    expect(update?.applicants_count).toBeLessThanOrEqual(30);
  });

  it('retract() resolves without throwing', async () => {
    const posting: PostingRef = {
      id: 'p-2',
      external_id: 'indeed-mock-x',
      tenant_id: TENANT,
    };
    await expect(
      indeedConnector.retract(ctx, posting, creds())
    ).resolves.toBeUndefined();
  });

  it('does NOT call axios in mock-mode', async () => {
    await indeedConnector.post(ctx, job, creds());
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('indeedConnector — real-mode', () => {
  beforeEach(() => {
    delete process.env.JOB_BOARDS_MOCK;
    vi.clearAllMocks();
  });

  it('post() calls axios with bearer auth + maps response', async () => {
    (axios.post as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      data: {
        id: 'indeed-real-id',
        url: 'https://employers.indeed.com/p/post/indeed-real-id',
        cost: 0,
      },
    });
    const result = await indeedConnector.post(ctx, job, creds(true));
    expect(result.external_id).toBe('indeed-real-id');
    expect(axios.post).toHaveBeenCalledTimes(1);
    const callArgs = (axios.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[2].headers.Authorization).toMatch(/^Bearer indeed-real/);
  });

  it('post() throws on upstream 4xx with real api_key', async () => {
    (axios.post as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation(async () => {
      const e = new Error('Bad Request') as Error & {
        response: { status: number };
      };
      e.response = { status: 400 };
      throw e;
    });
    await expect(indeedConnector.post(ctx, job, creds(true))).rejects.toThrow();
  });

  it('pollStatus() maps "expired" upstream to expired', async () => {
    (axios.get as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      data: { status: 'expired', applicants: 7 },
    });
    const update = await indeedConnector.pollStatus(
      ctx,
      { id: 'p-x', external_id: 'indeed-real-id', tenant_id: TENANT },
      creds(true)
    );
    expect(update?.status).toBe('expired');
    expect(update?.applicants_count).toBe(7);
  });
});

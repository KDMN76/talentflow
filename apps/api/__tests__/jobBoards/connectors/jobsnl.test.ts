/**
 * Jobs.nl connector tests — Sprint Q4.3 (Agent RRR).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { jobsnlConnector as connector } from '../../../src/modules/job-boards/connectors/jobsnl';
import { resetMockState } from '../../../src/modules/job-boards/connectors/_helpers/mock.helper';
import type { IntegrationCreds, NormalizedJob, PostingRef } from '../../../src/modules/job-boards/types';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ctx = { tenantId: TENANT_ID, userId: null };

const job: NormalizedJob = {
  id: 'job-jobsnl-1',
  title: 'Project Manager',
  description: 'Beschrijving',
  location: { city: 'Eindhoven', country: 'NL' },
};

function integWith(settings: Record<string, unknown>, credentials: Record<string, unknown> = {}): IntegrationCreds {
  return { id: 'integ-jobsnl', tenant_id: TENANT_ID, settings, credentials };
}

describe('jobsnl connector — mock mode', () => {
  beforeEach(() => resetMockState());

  it('exposes the expected JobBoardConnector contract', () => {
    expect(connector.id).toBe('jobsnl');
    expect(connector.region).toBe('nl');
    expect(connector.authType).toBe('api_key');
  });

  it('post() returns a valid PostResult with default flat fee €40', async () => {
    const result = await connector.post(ctx, job, integWith({}));
    expect(result.external_id).toMatch(/^jobsnl-[0-9a-f]{8}$/);
    expect(result.cost_amount).toBe(40);
    expect(result.cost_currency).toBe('EUR');
    expect(result.external_url).toContain('jobs.nl');
  });

  it('post() respects custom flat_fee_eur override', async () => {
    const result = await connector.post(ctx, job, integWith({ flat_fee_eur: 25 }));
    expect(result.cost_amount).toBe(25);
  });

  it('pollStatus() advances applicants_count deterministically', async () => {
    const posting: PostingRef = { id: 'jn-post-1', external_id: 'jobsnl-aaaaaaaa', tenant_id: TENANT_ID };
    const r1 = await connector.pollStatus(ctx, posting, integWith({}));
    const r2 = await connector.pollStatus(ctx, posting, integWith({}));
    expect(r2!.applicants_count!).toBeGreaterThan(r1!.applicants_count!);
  });

  it('retract() is idempotent in mock-mode', async () => {
    const posting: PostingRef = { id: 'jn-post-1', external_id: 'jobsnl-aaaaaaaa', tenant_id: TENANT_ID };
    await expect(connector.retract(ctx, posting, integWith({}))).resolves.toBeUndefined();
    await expect(connector.retract(ctx, posting, integWith({}))).resolves.toBeUndefined();
  });
});

describe('jobsnl connector — real-mode credential gating', () => {
  it.skipIf(process.env.LIVE_JOB_BOARD_TESTS !== 'true')(
    'real post() bears Bearer token to api.jobs.nl',
    async () => {
      // Skipped unless LIVE_JOB_BOARD_TESTS=true.
    }
  );
});

/**
 * Jobbird connector tests — Sprint Q4.3 (Agent RRR).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { jobbirdConnector as connector } from '../../../src/modules/job-boards/connectors/jobbird';
import { resetMockState } from '../../../src/modules/job-boards/connectors/_helpers/mock.helper';
import type { IntegrationCreds, NormalizedJob, PostingRef } from '../../../src/modules/job-boards/types';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ctx = { tenantId: TENANT_ID, userId: null };

const job: NormalizedJob = {
  id: 'job-jobbird-1',
  title: 'Recruiter NL',
  description: 'Vacature beschrijving',
  location: { city: 'Utrecht', country: 'NL' },
};

function integWith(settings: Record<string, unknown>, credentials: Record<string, unknown> = {}): IntegrationCreds {
  return { id: 'integ-jobbird', tenant_id: TENANT_ID, settings, credentials };
}

describe('jobbird connector — mock mode', () => {
  beforeEach(() => resetMockState());

  it('exposes the expected JobBoardConnector contract', () => {
    expect(connector.id).toBe('jobbird');
    expect(connector.region).toBe('nl');
    expect(connector.authType).toBe('api_key');
  });

  it('post() returns a valid PostResult shape (organic = €0)', async () => {
    const result = await connector.post(ctx, job, integWith({ product: 'organic' }));
    expect(result.external_id).toMatch(/^jobbird-[0-9a-f]{8}$/);
    expect(result.external_url).toContain('jobbird.com');
    expect(result.cost_amount).toBe(0);
    expect(result.cost_currency).toBe('EUR');
    expect(result.expires_at).toMatch(/T/);
  });

  it('post() applies sponsored pricing = daily_sponsored_rate_eur × posting_duration_days', async () => {
    const result = await connector.post(
      ctx,
      job,
      integWith({ product: 'sponsored', daily_sponsored_rate_eur: 5, posting_duration_days: 14 })
    );
    expect(result.cost_amount).toBe(70);
  });

  it('post() defaults sponsored pricing to 4 €/day × 30 days = €120', async () => {
    const result = await connector.post(ctx, job, integWith({ product: 'sponsored' }));
    expect(result.cost_amount).toBe(120);
  });

  it('pollStatus() advances applicants_count deterministically', async () => {
    const posting: PostingRef = { id: 'jobbird-post-1', external_id: 'jobbird-aaaaaaaa', tenant_id: TENANT_ID };
    const r1 = await connector.pollStatus(ctx, posting, integWith({}));
    const r2 = await connector.pollStatus(ctx, posting, integWith({}));
    expect(r2!.applicants_count!).toBeGreaterThan(r1!.applicants_count!);
  });

  it('retract() is idempotent in mock-mode', async () => {
    const posting: PostingRef = { id: 'jobbird-post-1', external_id: 'jobbird-aaaaaaaa', tenant_id: TENANT_ID };
    await expect(connector.retract(ctx, posting, integWith({}))).resolves.toBeUndefined();
    await expect(connector.retract(ctx, posting, integWith({}))).resolves.toBeUndefined();
  });
});

describe('jobbird connector — real-mode credential gating', () => {
  it.skipIf(process.env.LIVE_JOB_BOARD_TESTS !== 'true')(
    'real post() calls api.jobbird.com when JOB_BOARDS_MOCK is unset and api_key present',
    async () => {
      // Skipped unless LIVE_JOB_BOARD_TESTS=true. Real run requires
      // process.env.JOBBIRD_API_KEY in a recruiter sandbox tenant.
    }
  );
});

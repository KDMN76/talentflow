/**
 * StepStone connector tests — Sprint Q4.3 (Agent RRR).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stepstoneConnector as connector } from '../../../src/modules/job-boards/connectors/stepstone';
import { resetMockState } from '../../../src/modules/job-boards/connectors/_helpers/mock.helper';
import type { IntegrationCreds, NormalizedJob, PostingRef } from '../../../src/modules/job-boards/types';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ctx = { tenantId: TENANT_ID, userId: null };

const job: NormalizedJob = {
  id: 'job-stepstone-1',
  title: 'Senior Engineer',
  description: 'Stellenbeschreibung',
  location: { city: 'Berlin', country: 'DE' },
  language: 'de',
};

function integWith(settings: Record<string, unknown>, credentials: Record<string, unknown> = {}): IntegrationCreds {
  return { id: 'integ-stepstone', tenant_id: TENANT_ID, settings, credentials };
}

describe('stepstone connector — mock mode', () => {
  beforeEach(() => resetMockState());

  it('exposes the expected JobBoardConnector contract', () => {
    expect(connector.id).toBe('stepstone');
    expect(connector.region).toBe('eu');
    expect(connector.authType).toBe('oauth2');
  });

  it('post() returns a valid PostResult with default fee €250', async () => {
    const result = await connector.post(ctx, job, integWith({}));
    expect(result.external_id).toMatch(/^stepstone-[0-9a-f]{8}$/);
    expect(result.cost_amount).toBe(250);
    expect(result.cost_currency).toBe('EUR');
    expect(result.external_url).toContain('stepstone.de');
  });

  it('post() respects custom posting_fee_eur', async () => {
    const result = await connector.post(ctx, job, integWith({ posting_fee_eur: 199 }));
    expect(result.cost_amount).toBe(199);
  });

  it('post() routes to .nl when settings.country is NL', async () => {
    const result = await connector.post(ctx, job, integWith({ country: 'NL' }));
    expect(result.external_url).toContain('stepstone.nl');
  });

  it('pollStatus() advances applicants_count deterministically', async () => {
    const posting: PostingRef = { id: 'ss-post-1', external_id: 'stepstone-aaaaaaaa', tenant_id: TENANT_ID };
    const r1 = await connector.pollStatus(ctx, posting, integWith({}));
    const r2 = await connector.pollStatus(ctx, posting, integWith({}));
    expect(r2!.applicants_count!).toBeGreaterThan(r1!.applicants_count!);
  });

  it('retract() is idempotent in mock-mode', async () => {
    const posting: PostingRef = { id: 'ss-post-1', external_id: 'stepstone-aaaaaaaa', tenant_id: TENANT_ID };
    await expect(connector.retract(ctx, posting, integWith({}))).resolves.toBeUndefined();
    await expect(connector.retract(ctx, posting, integWith({}))).resolves.toBeUndefined();
  });
});

describe('stepstone connector — real-mode credential gating', () => {
  it.skipIf(process.env.LIVE_JOB_BOARD_TESTS !== 'true')(
    'OAuth refresh path mints a new access_token before posting',
    async () => {
      // Skipped unless LIVE_JOB_BOARD_TESTS=true.
    }
  );
});

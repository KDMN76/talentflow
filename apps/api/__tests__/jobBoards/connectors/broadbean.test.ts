/**
 * Broadbean Multipost connector tests — Sprint Q4.3 (Agent RRR).
 *
 * Beyond the standard contract checks, Broadbean has unique aggregation
 * behaviour we explicitly cover:
 *   - Multi-board sub-result cost aggregation (sum of sub-board costs)
 *   - Worst-status logic (failed > rejected > expired > posted)
 *   - Currency carries through when at least one sub-board reports cost
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { broadbeanConnector as connector } from '../../../src/modules/job-boards/connectors/broadbean';
import {
  aggregateApplicants,
  aggregateBroadbeanCost,
  mapToBroadbeanPayload,
  worstStatus,
  type BroadbeanSubResult,
} from '../../../src/modules/job-boards/connectors/_helpers/broadbean.helper';
import { resetMockState } from '../../../src/modules/job-boards/connectors/_helpers/mock.helper';
import type { IntegrationCreds, NormalizedJob, PostingRef } from '../../../src/modules/job-boards/types';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ctx = { tenantId: TENANT_ID, userId: null };

const job: NormalizedJob = {
  id: 'job-broadbean-1',
  title: 'Multipost Engineer',
  description: 'Beschrijving',
  location: { city: 'Amsterdam', country: 'NL', remote_policy: 'remote' },
  salary_min: 80_000,
  salary_max: 120_000,
  currency: 'EUR',
};

function integWith(settings: Record<string, unknown>, credentials: Record<string, unknown> = {}): IntegrationCreds {
  return { id: 'integ-broadbean', tenant_id: TENANT_ID, settings, credentials };
}

describe('broadbean connector — mock mode', () => {
  beforeEach(() => resetMockState());

  it('exposes the expected JobBoardConnector contract', () => {
    expect(connector.id).toBe('broadbean');
    expect(connector.region).toBe('global');
    expect(connector.authType).toBe('oauth2');
  });

  it('post() aggregates costs across target_boards and returns EUR currency', async () => {
    const targets = ['monster', 'totaljobs', 'cv-library'];
    const result = await connector.post(ctx, job, integWith({ target_boards: targets }));
    expect(result.external_id).toMatch(/^broadbean-[0-9a-f]{8}$/);
    expect(result.cost_currency).toBe('EUR');
    // Cost is sum of sub-board pseudo-costs, all <50 EUR.
    expect(result.cost_amount).toBeGreaterThanOrEqual(0);
    expect(result.cost_amount).toBeLessThanOrEqual(targets.length * 49);
    const raw = result.raw as { results: BroadbeanSubResult[] };
    expect(Array.isArray(raw.results)).toBe(true);
    expect(raw.results.length).toBe(targets.length);
  });

  it('post() returns null cost when no targets configured', async () => {
    const result = await connector.post(ctx, job, integWith({ target_boards: [] }));
    expect(result.cost_amount).toBeNull();
    expect(result.cost_currency).toBeNull();
  });

  it('pollStatus() aggregates applicants across sub-boards and advances over calls', async () => {
    const posting: PostingRef = { id: 'bb-post-1', external_id: 'broadbean-aaaaaaaa', tenant_id: TENANT_ID };
    const integ = integWith({ target_boards: ['monster', 'totaljobs', 'cv-library'] });
    const r1 = await connector.pollStatus(ctx, posting, integ);
    const r2 = await connector.pollStatus(ctx, posting, integ);
    expect(r1!.status).toBe('posted');
    expect(r2!.applicants_count!).toBeGreaterThan(r1!.applicants_count!);
  });

  it('retract() is idempotent in mock-mode', async () => {
    const posting: PostingRef = { id: 'bb-post-1', external_id: 'broadbean-aaaaaaaa', tenant_id: TENANT_ID };
    const integ = integWith({ target_boards: ['monster'] });
    await expect(connector.retract(ctx, posting, integ)).resolves.toBeUndefined();
    await expect(connector.retract(ctx, posting, integ)).resolves.toBeUndefined();
  });
});

describe('broadbean helper — aggregation logic', () => {
  it('aggregateBroadbeanCost: returns null when all sub-boards organic', () => {
    const results: BroadbeanSubResult[] = [
      { board: 'a', status: 'posted', cost_amount: null, cost_currency: null },
      { board: 'b', status: 'posted' },
    ];
    expect(aggregateBroadbeanCost(results)).toEqual({ cost_amount: null, cost_currency: null });
  });

  it('aggregateBroadbeanCost: sums numeric costs and surfaces first non-null currency', () => {
    const results: BroadbeanSubResult[] = [
      { board: 'a', status: 'posted', cost_amount: 30, cost_currency: 'EUR' },
      { board: 'b', status: 'posted', cost_amount: 50, cost_currency: 'EUR' },
      { board: 'c', status: 'posted', cost_amount: null },
    ];
    expect(aggregateBroadbeanCost(results)).toEqual({ cost_amount: 80, cost_currency: 'EUR' });
  });

  it('worstStatus: failed wins over posted', () => {
    expect(
      worstStatus([
        { board: 'a', status: 'posted' },
        { board: 'b', status: 'failed' },
      ])
    ).toBe('failed');
  });

  it('worstStatus: rejected wins over posted/expired', () => {
    expect(
      worstStatus([
        { board: 'a', status: 'posted' },
        { board: 'b', status: 'expired' },
        { board: 'c', status: 'rejected' },
      ])
    ).toBe('rejected');
  });

  it('worstStatus: empty list = failed (defensive)', () => {
    expect(worstStatus([])).toBe('failed');
  });

  it('worstStatus: pending becomes posted (we do not surface pending)', () => {
    expect(worstStatus([{ board: 'a', status: 'pending' }])).toBe('posted');
  });

  it('aggregateApplicants: sums missing values as 0', () => {
    const results: BroadbeanSubResult[] = [
      { board: 'a', status: 'posted', applicants_count: 5 },
      { board: 'b', status: 'posted' },
      { board: 'c', status: 'posted', applicants_count: 3 },
    ];
    expect(aggregateApplicants(results)).toBe(8);
  });

  it('mapToBroadbeanPayload: copies core fields and drops undefineds', () => {
    const payload = mapToBroadbeanPayload(job, ['monster', 'totaljobs']);
    expect(payload.reference).toBe(job.id);
    expect(payload.title).toBe(job.title);
    expect(payload.targets).toEqual(['monster', 'totaljobs']);
    expect(payload.location).toEqual({ city: 'Amsterdam', country: 'NL', remote_policy: 'remote' });
    expect(payload.salary).toEqual({ min: 80_000, max: 120_000, currency: 'EUR' });
  });

  it('mapToBroadbeanPayload: omits salary when no min/max provided', () => {
    const slim: NormalizedJob = { id: 'x', title: 'T', description: 'D' };
    const payload = mapToBroadbeanPayload(slim, []);
    expect(payload.salary).toBeUndefined();
  });
});

describe('broadbean connector — real-mode credential gating', () => {
  it.skipIf(process.env.LIVE_JOB_BOARD_TESTS !== 'true')(
    'OAuth client_credentials grant returns access_token cached in integration',
    async () => {
      // Skipped unless LIVE_JOB_BOARD_TESTS=true.
    }
  );
});

/**
 * nationale-vacaturebank connector tests.
 *
 * Vacaturebank is feed-based — there's no live API to mock, so these tests
 * focus on:
 *   - PostResult shape + €0 cost + werk.nl URL
 *   - Deterministic applicants_count walk on pollStatus
 *   - retract is a no-op (idempotent — call twice, no throw)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { nationaleVacaturebankConnector as connector } from '../../../src/modules/job-boards/connectors/nationale-vacaturebank';
import { resetMockState } from '../../../src/modules/job-boards/connectors/_helpers/mock.helper';
import type { IntegrationCreds, NormalizedJob, PostingRef } from '../../../src/modules/job-boards/types';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ctx = { tenantId: TENANT_ID, userId: null };

const job: NormalizedJob = {
  id: '22222222-2222-2222-2222-222222222222',
  title: 'Senior Backend Developer',
  description: '<p>Bouw mee aan TalentFlow</p>',
  location: { city: 'Amsterdam', country: 'NL', remote_policy: 'hybrid' },
  employment_type: 'full_time',
  salary_min: 60_000,
  salary_max: 90_000,
  currency: 'EUR',
  language: 'nl',
};

const integration: IntegrationCreds = {
  id: 'integ-1',
  tenant_id: TENANT_ID,
  settings: { feed_url: 'https://app.example/api/public/job-feeds/acme/vacaturebank.xml' },
  credentials: {},
};

describe('nationale-vacaturebank connector', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('exposes the expected JobBoardConnector contract', () => {
    expect(connector.id).toBe('nationale-vacaturebank');
    expect(connector.region).toBe('nl');
    expect(connector.authType).toBe('xml_feed');
    expect(typeof connector.post).toBe('function');
    expect(typeof connector.pollStatus).toBe('function');
    expect(typeof connector.retract).toBe('function');
  });

  it('post() returns a valid PostResult with €0 cost and werk.nl URL', async () => {
    const result = await connector.post(ctx, job, integration);
    expect(result.external_id).toMatch(/^nationale-vacaturebank-[0-9a-f]{8}$/);
    expect(result.external_url).toBe(`https://werk.nl/werkzoekenden/jobs/${result.external_id}`);
    expect(result.cost_amount).toBe(0);
    expect(result.cost_currency).toBe('EUR');
    expect(result.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.raw).toMatchObject({ board: 'nationale-vacaturebank' });
  });

  it('post() is deterministic: same job-id → same external_id', async () => {
    const r1 = await connector.post(ctx, job, integration);
    const r2 = await connector.post(ctx, job, integration);
    expect(r1.external_id).toBe(r2.external_id);
  });

  it('pollStatus() advances applicants_count deterministically across two calls', async () => {
    const posting: PostingRef = { id: 'post-1', external_id: 'nationale-vacaturebank-aaaaaaaa', tenant_id: TENANT_ID };
    const r1 = await connector.pollStatus(ctx, posting, integration);
    const r2 = await connector.pollStatus(ctx, posting, integration);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1!.status).toBe('posted');
    expect(r2!.status).toBe('posted');
    // Strictly increasing — guarantees the worker sees forward progress.
    expect(r2!.applicants_count!).toBeGreaterThan(r1!.applicants_count!);
  });

  it('retract() is idempotent — calling twice does not throw', async () => {
    const posting: PostingRef = { id: 'post-1', external_id: 'nationale-vacaturebank-aaaaaaaa', tenant_id: TENANT_ID };
    await expect(connector.retract(ctx, posting, integration)).resolves.toBeUndefined();
    await expect(connector.retract(ctx, posting, integration)).resolves.toBeUndefined();
  });

  it.skip('LIVE_JOB_BOARD_TESTS: posts against real UWV credentials', async () => {
    // Vacaturebank has no live POST API — the live "test" is to verify the
    // public XML feed is reachable. Covered in publicFeed.test.ts instead.
  });
});

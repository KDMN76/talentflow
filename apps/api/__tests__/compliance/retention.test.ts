/**
 * Retention service tests — Sprint Q2.3.
 *
 * Test:
 *   - createRetentionPolicy: insert + audit
 *   - duplicate-policy: 23505 → AppError 409
 *   - applyRetentionPolicy with action=archive: zet deleted_at
 *   - applyRetentionPolicy with action=anonymize: roept anonymize service
 *   - applyRetentionPolicy with action=delete: hard-delete
 *   - setCandidateRetentionExcluded: 404 + audit-event
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

vi.mock('../../src/modules/compliance/anonymization.service', () => ({
  anonymizeCandidatePermanently: vi.fn(async () => undefined),
}));

import {
  createRetentionPolicy,
  applyRetentionPolicy,
  setCandidateRetentionExcluded,
  type RetentionPolicyRow,
} from '../../src/modules/compliance/retention.service';
import { anonymizeCandidatePermanently } from '../../src/modules/compliance/anonymization.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const POLICY_ID = '55555555-5555-5555-5555-555555555555';
const CAND_ID = '33333333-3333-3333-3333-333333333333';

function buildPolicy(overrides: Partial<RetentionPolicyRow> = {}): RetentionPolicyRow {
  return {
    id: POLICY_ID,
    tenant_id: TENANT_ID,
    entity_type: 'candidate',
    retention_months: 24,
    trigger_field: 'last_activity_at',
    action_on_expiry: 'anonymize',
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('createRetentionPolicy', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('insert nieuwe policy + audit-event', async () => {
    const created = buildPolicy();
    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO retention_policies/i.test(sql)) {
          return { rows: [created], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await createRetentionPolicy(TENANT_ID, USER_ID, {
      entity_type: 'candidate',
      retention_months: 24,
      action_on_expiry: 'anonymize',
    });

    expect(result.id).toBe(POLICY_ID);
    const audit = client.query.mock.calls.find((c) =>
      /INSERT INTO audit_events/i.test(String(c[0]))
    );
    expect(audit).toBeTruthy();
    expect((audit![1] as unknown[])[2]).toBe('retention_policy.created');
  });

  it('vertaalt unique-violation 23505 naar AppError 409', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO retention_policies/i.test(sql)) {
          const err = new Error('duplicate key') as Error & { code: string };
          err.code = '23505';
          throw err;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      createRetentionPolicy(TENANT_ID, USER_ID, {
        entity_type: 'candidate',
        retention_months: 24,
        action_on_expiry: 'anonymize',
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'RETENTION_POLICY_DUPLICATE',
    });
  });
});

describe('applyRetentionPolicy', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('action=archive zet deleted_at op verlopen kandidaten', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (
          /SELECT id, candidate_reference[\s\S]*FROM candidates/i.test(sql)
        ) {
          return {
            rows: [{ id: CAND_ID, candidate_reference: 'ABC' }],
            rowCount: 1,
          };
        }
        if (/UPDATE candidates[\s\S]*deleted_at = now/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await applyRetentionPolicy(
      TENANT_ID,
      buildPolicy({ action_on_expiry: 'archive' })
    );

    expect(result.candidates_processed).toBe(1);
    expect(result.action).toBe('archive');

    const archivedCall = client.query.mock.calls.find((c) =>
      /UPDATE candidates[\s\S]*deleted_at = now/i.test(String(c[0]))
    );
    expect(archivedCall).toBeTruthy();
  });

  it('action=anonymize roept anonymizeCandidatePermanently', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (
          /SELECT id, candidate_reference[\s\S]*FROM candidates/i.test(sql)
        ) {
          return {
            rows: [{ id: CAND_ID, candidate_reference: 'XYZ' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await applyRetentionPolicy(
      TENANT_ID,
      buildPolicy({ action_on_expiry: 'anonymize' })
    );

    expect(result.candidates_processed).toBe(1);
    expect(anonymizeCandidatePermanently).toHaveBeenCalledWith(
      TENANT_ID,
      CAND_ID,
      null,
      expect.any(Object)
    );
  });

  it('action=delete doet DELETE FROM candidates', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (
          /SELECT id, candidate_reference[\s\S]*FROM candidates/i.test(sql)
        ) {
          return {
            rows: [{ id: CAND_ID, candidate_reference: null }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await applyRetentionPolicy(
      TENANT_ID,
      buildPolicy({ action_on_expiry: 'delete' })
    );

    const deleteCall = client.query.mock.calls.find((c) =>
      /DELETE FROM candidates/i.test(String(c[0]))
    );
    expect(deleteCall).toBeTruthy();
  });

  it('skipt entity_type=application (out of scope MVP)', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    const result = await applyRetentionPolicy(
      TENANT_ID,
      buildPolicy({ entity_type: 'application' })
    );

    expect(result.candidates_processed).toBe(0);
    // Geen SELECT-verlopen-rows query.
    const selectCall = client.query.mock.calls.find((c) =>
      /SELECT id, candidate_reference/i.test(String(c[0]))
    );
    expect(selectCall).toBeUndefined();
  });

  it('telt errors per kandidaat zonder de hele run te laten falen', async () => {
    (anonymizeCandidatePermanently as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'));

    client = mockClient({
      __matcher: (sql) => {
        if (
          /SELECT id, candidate_reference[\s\S]*FROM candidates/i.test(sql)
        ) {
          return {
            rows: [
              { id: CAND_ID, candidate_reference: 'A' },
              { id: 'cand-other', candidate_reference: 'B' },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await applyRetentionPolicy(
      TENANT_ID,
      buildPolicy({ action_on_expiry: 'anonymize' })
    );

    expect(result.errors).toBe(1);
    expect(result.candidates_processed).toBe(1);
  });
});

describe('setCandidateRetentionExcluded', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('updaten + audit-event candidate.retention_excluded', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/UPDATE candidates[\s\S]*retention_excluded/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await setCandidateRetentionExcluded(
      TENANT_ID,
      CAND_ID,
      true,
      'Pre-employment screening',
      USER_ID
    );

    const audit = client.query.mock.calls.find((c) =>
      /INSERT INTO audit_events/i.test(String(c[0]))
    );
    expect((audit![1] as unknown[])[2]).toBe('candidate.retention_excluded');
  });

  it('throwt 404 als kandidaat niet bestaat', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      setCandidateRetentionExcluded(TENANT_ID, CAND_ID, true, null, USER_ID)
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
  });
});

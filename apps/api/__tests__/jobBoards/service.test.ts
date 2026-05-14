import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

// Mock the queue add() so we can detect enqueue without Redis.
const { queueAddSpy } = vi.hoisted(() => ({
  queueAddSpy: vi.fn(async () => ({ id: 'mock-job' })),
}));
vi.mock('../../src/queue/queues', () => ({
  jobBoardPostQueue: { add: queueAddSpy },
  jobBoardPollQueue: { add: vi.fn(async () => ({ id: 'mock-job' })) },
}));

import * as service from '../../src/modules/job-boards/service';
import {
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
} from '../../src/lib/encryption';

const TENANT = '11111111-1111-1111-1111-111111111111';
const TENANT2 = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

describe('lib/encryption', () => {
  it('round-trips a plaintext string', () => {
    const blob = encrypt('hello-world');
    expect(Buffer.isBuffer(blob)).toBe(true);
    expect(decrypt(blob)).toBe('hello-world');
  });

  it('round-trips a JSON object', () => {
    const blob = encryptJson({ access_token: 'foo', refresh_token: 'bar' });
    const decoded = decryptJson<{ access_token: string }>(blob);
    expect(decoded.access_token).toBe('foo');
  });

  it('produces different ciphertexts for the same input (random IV)', () => {
    const a = encrypt('x'.repeat(20));
    const b = encrypt('x'.repeat(20));
    expect(a.equals(b)).toBe(false);
  });

  it('throws on tampered ciphertext', () => {
    const blob = encrypt('payload');
    blob[blob.length - 1] ^= 0xff;
    expect(() => decrypt(blob)).toThrow();
  });
});

describe('service.connectIntegration', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    queueAddSpy.mockClear();
  });
  afterEach(() => teardown?.());

  it('inserts an integration with encrypted credentials + audit event', async () => {
    let inserted: Record<string, unknown> | null = null;
    let auditedAction: string | null = null;
    client = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO job_board_integrations/i.test(sql)) {
          inserted = {
            id: 'integ-1',
            tenant_id: params[0],
            board_id: params[1],
            display_name: params[2],
            status: 'connected',
            settings: JSON.parse(params[4] as string),
            connected_by: params[5],
            connected_at: new Date().toISOString(),
            last_polled_at: null,
            last_error: null,
            created_at: new Date().toISOString(),
          };
          // capture encrypted blob for verification
          (inserted as Record<string, unknown>).__creds_encrypted = params[3];
          return { rows: [inserted], rowCount: 1 };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          auditedAction = params[2] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const integration = await service.connectIntegration(
      TENANT,
      'linkedin',
      { access_token: 'live-token-12345', refresh_token: 'live-refresh-12345' },
      {
        displayName: 'LinkedIn — primary',
        userId: USER_ID,
      }
    );

    expect(integration.board_id).toBe('linkedin');
    expect(integration.status).toBe('connected');
    expect(auditedAction).toBe('job_board.integration.connected');
    // Verify the encrypted blob round-trips
    const blob = inserted!.__creds_encrypted as Buffer;
    const decrypted = JSON.parse(decrypt(blob));
    expect(decrypted.access_token).toBe('live-token-12345');
  });

  it('rejects unknown board ids', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.connectIntegration(TENANT, 'doesnt-exist', {})
    ).rejects.toMatchObject({ code: 'UNKNOWN_BOARD' });
  });
});

describe('service.disconnectIntegration', () => {
  let client: MockClient;
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('marks integration disconnected AND retracts live postings', async () => {
    const ops: string[] = [];
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM job_board_integrations/i.test(sql)) {
          return { rows: [{ id: 'integ-1' }], rowCount: 1 };
        }
        if (/UPDATE job_postings\b[^]*status = 'retracted'/i.test(sql)) {
          ops.push('postings_retracted');
          return { rows: [], rowCount: 2 };
        }
        if (/UPDATE job_board_integrations\b[^]*status = 'disconnected'/i.test(sql)) {
          ops.push('integration_disconnected');
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          ops.push('audit');
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await service.disconnectIntegration(TENANT, 'linkedin', { userId: USER_ID });
    expect(ops).toContain('postings_retracted');
    expect(ops).toContain('integration_disconnected');
    expect(ops).toContain('audit');
  });

  it('throws 404 when integration does not exist', async () => {
    teardown = installPoolMock(
      mockClient({ __matcher: () => ({ rows: [], rowCount: 0 }) })
    );
    await expect(
      service.disconnectIntegration(TENANT, 'linkedin')
    ).rejects.toMatchObject({ code: 'INTEGRATION_NOT_FOUND' });
  });
});

describe('service.enqueuePosting', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('inserts a queued posting + status event + enqueues queue job', async () => {
    const calls: string[] = [];
    queueAddSpy.mockClear();
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM job_board_integrations/i.test(sql)) {
          return {
            rows: [{ id: 'integ-1' }],
            rowCount: 1,
          };
        }
        if (/SELECT id FROM jobs/i.test(sql)) {
          return { rows: [{ id: 'job-1' }], rowCount: 1 };
        }
        if (/INSERT INTO job_postings/i.test(sql)) {
          calls.push('posting_insert');
          return {
            rows: [
              {
                id: 'post-1',
                tenant_id: TENANT,
                job_id: 'job-1',
                board_id: 'linkedin',
                integration_id: 'integ-1',
                status: 'queued',
                applicants_count: 0,
                cost_currency: 'EUR',
                metadata: {},
                created_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO job_posting_status_events/i.test(sql)) {
          calls.push('status_event');
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          calls.push('audit');
        }
        return { rows: [], rowCount: 1 };
      },
    });
    teardown = installPoolMock(client);

    const posting = await service.enqueuePosting(
      TENANT,
      '00000000-0000-0000-0000-000000000001',
      'linkedin',
      { userId: USER_ID }
    );
    expect(posting.id).toBe('post-1');
    expect(calls).toContain('posting_insert');
    expect(calls).toContain('status_event');
    expect(calls).toContain('audit');
    expect(queueAddSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown board id', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.enqueuePosting(TENANT, '00000000-0000-0000-0000-000000000001', 'fake-board')
    ).rejects.toMatchObject({ code: 'UNKNOWN_BOARD' });
  });

  it('throws JOB_NOT_FOUND when job missing', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT id FROM job_board_integrations/i.test(sql)) {
            return { rows: [{ id: 'integ-1' }], rowCount: 1 };
          }
          if (/SELECT id FROM jobs/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.enqueuePosting(TENANT, '00000000-0000-0000-0000-000000000099', 'linkedin')
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });
});

describe('service.recordHireCost', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('inserts cost-per-hire record with attributed_cost from posting', async () => {
    let inserted: unknown[] | null = null;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/SELECT id, candidate_id, job_id, source\s+FROM applications/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'app-1',
                  candidate_id: 'cand-1',
                  job_id: 'job-1',
                  source: 'linkedin:posted',
                },
              ],
              rowCount: 1,
            };
          }
          if (/SELECT id, cost_amount FROM job_postings/i.test(sql)) {
            return {
              rows: [{ id: 'post-1', cost_amount: '49.00' }],
              rowCount: 1,
            };
          }
          if (/INSERT INTO cost_per_hire_records/i.test(sql)) {
            inserted = params as unknown[];
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );

    await service.recordHireCost(TENANT, 'app-1');
    expect(inserted).not.toBeNull();
    // params: [tenant, job, app, posting, source, cost]
    expect(inserted![1]).toBe('job-1');
    expect(inserted![3]).toBe('post-1');
    expect(inserted![4]).toBe('linkedin');
    expect(Number(inserted![5])).toBe(49);
  });

  it('inserts a row with NULL cost when no posting linked', async () => {
    let inserted: unknown[] | null = null;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/SELECT id, candidate_id, job_id, source\s+FROM applications/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'app-2',
                  candidate_id: 'cand-2',
                  job_id: 'job-2',
                  source: null,
                },
              ],
              rowCount: 1,
            };
          }
          if (/INSERT INTO cost_per_hire_records/i.test(sql)) {
            inserted = params as unknown[];
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await service.recordHireCost(TENANT, 'app-2');
    expect(inserted![5]).toBeNull();
  });
});

describe('service.listCatalog — cross-tenant isolation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('only returns connected state for the tenant in scope', async () => {
    let observedSetTenant: string | null = null;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/SET LOCAL app\.tenant_id/i.test(sql)) {
            const m = sql.match(/'([0-9a-f-]{36})'/i);
            observedSetTenant = m?.[1] ?? null;
            return { rows: [], rowCount: 0 };
          }
          if (/SELECT id, board_id, status FROM job_board_integrations/i.test(sql)) {
            // RLS would normally filter — we simulate by returning only
            // tenant1 data when tenant1 is queried.
            if (observedSetTenant === TENANT) {
              return {
                rows: [{ id: 'integ-t1', board_id: 'linkedin', status: 'connected' }],
                rowCount: 1,
              };
            }
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );

    const tenant1 = await service.listCatalog(TENANT);
    const tenant2 = await service.listCatalog(TENANT2);

    const li1 = tenant1.find((c) => c.id === 'linkedin');
    const li2 = tenant2.find((c) => c.id === 'linkedin');
    expect(li1?.connected).toBe(true);
    expect(li2?.connected).toBe(false);
  });
});

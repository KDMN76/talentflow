import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

import * as service from '../../src/modules/contracts/contracts.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const CAND_A = '22222222-2222-2222-2222-222222222222';
const USER_A = '33333333-3333-3333-3333-333333333333';
const CONTRACT_ID = '44444444-4444-4444-4444-444444444444';

function nowIso(): string {
  return new Date().toISOString();
}

function existingContractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTRACT_ID,
    tenant_id: TENANT_A,
    candidate_id: CAND_A,
    application_id: null,
    client_organization_id: null,
    job_id: null,
    contract_type: 'temp',
    status: 'active',
    start_date: '2026-01-01',
    end_date: '2026-06-30',
    weekly_hours: 40,
    hourly_rate_candidate: 25,
    hourly_rate_client: 50,
    margin_percent: 50,
    currency: 'EUR',
    cao: null,
    wtza_compliant: null,
    metadata: {},
    signed_at: null,
    terminated_at: null,
    termination_reason: null,
    created_by: USER_A,
    created_at: nowIso(),
    updated_at: nowIso(),
    ...overrides,
  };
}

describe('computeMarginPercent', () => {
  it('returns null when client rate is missing or zero', () => {
    expect(service.computeMarginPercent(25, null)).toBeNull();
    expect(service.computeMarginPercent(25, 0)).toBeNull();
    expect(service.computeMarginPercent(null, 50)).toBeNull();
  });

  it('computes (client - candidate) / client * 100 rounded to 2 decimals', () => {
    expect(service.computeMarginPercent(25, 50)).toBe(50);
    expect(service.computeMarginPercent(30, 50)).toBe(40);
    expect(service.computeMarginPercent(33.33, 100)).toBe(66.67);
  });

  it('returns negative margin for inverted rates (loss-making)', () => {
    expect(service.computeMarginPercent(60, 50)).toBe(-20);
  });
});

describe('createContract', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('inserts a row with derived margin_percent and audit + scheduled notifications', async () => {
    const inserts: { sql: string; params: unknown[] }[] = [];
    let auditAction: string | null = null;
    let notificationsScheduled = 0;

    const client: MockClient = mockClient({
      __matcher: (sql, params) => {
        inserts.push({ sql, params });
        if (/INSERT INTO contracts/i.test(sql)) {
          return {
            rows: [
              existingContractRow({
                margin_percent: params[12] as number,
                start_date: params[7] as string,
                end_date: params[8] as string,
                hourly_rate_candidate: params[10] as number,
                hourly_rate_client: params[11] as number,
                status: params[6] as string,
              }),
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          auditAction = params[2] as string;
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO contract_notification_queue/i.test(sql)) {
          notificationsScheduled++;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const contract = await service.createContract(
      TENANT_A,
      {
        candidate_id: CAND_A,
        start_date: '2026-01-01',
        end_date: '2026-06-30',
        hourly_rate_candidate: 25,
        hourly_rate_client: 50,
        contract_type: 'temp',
        status: 'active',
      },
      { userId: USER_A }
    );

    expect(contract.margin_percent).toBe(50);
    expect(auditAction).toBe('contract.created');
    // 4 notifications scheduled: 30d, 14d, 7d, ended
    expect(notificationsScheduled).toBe(4);
  });

  it('rejects when candidate_id missing', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      // @ts-expect-error testing runtime guard
      service.createContract(TENANT_A, { start_date: '2026-01-01' })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects when start_date missing', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      // @ts-expect-error testing runtime guard
      service.createContract(TENANT_A, { candidate_id: CAND_A })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('does not schedule notifications when no end_date (permanent)', async () => {
    let notificationsScheduled = 0;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/INSERT INTO contracts/i.test(sql)) {
            return {
              rows: [existingContractRow({ end_date: null, contract_type: 'permanent' })],
              rowCount: 1,
            };
          }
          if (/INSERT INTO contract_notification_queue/i.test(sql)) {
            notificationsScheduled++;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await service.createContract(TENANT_A, {
      candidate_id: CAND_A,
      start_date: '2026-01-01',
      contract_type: 'permanent',
    });
    expect(notificationsScheduled).toBe(0);
  });
});

describe('updateContract', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('blocks edits on ended contracts (except metadata)', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return {
              rows: [existingContractRow({ status: 'ended' })],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.updateContract(TENANT_A, CONTRACT_ID, {
        weekly_hours: 32,
      })
    ).rejects.toMatchObject({ code: 'CONTRACT_CLOSED' });
  });

  it('recomputes margin when rates change', async () => {
    let updatedMargin: number | null = null;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return {
              rows: [existingContractRow({ status: 'active' })],
              rowCount: 1,
            };
          }
          if (/UPDATE contracts/i.test(sql)) {
            // The UPDATE contains margin_percent — we can extract it from
            // params by reflection on the SQL ordering.
            const idx = sql
              .split(',')
              .findIndex((s) => /margin_percent\s*=\s*\$/i.test(s));
            if (idx >= 0) {
              const m = sql.match(/margin_percent\s*=\s*\$(\d+)/i);
              if (m) updatedMargin = params[Number(m[1]) - 1] as number;
            }
            return {
              rows: [
                existingContractRow({
                  hourly_rate_candidate: 30,
                  hourly_rate_client: 60,
                  margin_percent: 50,
                }),
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const updated = await service.updateContract(
      TENANT_A,
      CONTRACT_ID,
      { hourly_rate_candidate: 30, hourly_rate_client: 60 },
      { userId: USER_A }
    );
    expect(updated.margin_percent).toBe(50);
    expect(updatedMargin).toBe(50);
  });

  it('throws 404 when contract not found', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.updateContract(TENANT_A, CONTRACT_ID, { weekly_hours: 24 })
    ).rejects.toMatchObject({ code: 'CONTRACT_NOT_FOUND' });
  });
});

describe('extendContract', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('inserts contract_extensions row + flips status active and updates end_date', async () => {
    let extInserted = false;
    let scheduled = 0;
    let deletedPending = false;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return { rows: [existingContractRow()], rowCount: 1 };
          }
          if (/INSERT INTO contract_extensions/i.test(sql)) {
            extInserted = true;
            return {
              rows: [
                {
                  id: 'ext-1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  previous_end_date: '2026-06-30',
                  new_end_date: '2026-12-31',
                  reason: 'verlenging',
                  signed_at: nowIso(),
                  signed_by: USER_A,
                  created_at: nowIso(),
                },
              ],
              rowCount: 1,
            };
          }
          if (/UPDATE contracts/i.test(sql)) {
            return {
              rows: [existingContractRow({ end_date: '2026-12-31', status: 'active' })],
              rowCount: 1,
            };
          }
          if (/DELETE FROM contract_notification_queue/i.test(sql)) {
            deletedPending = true;
            return { rows: [], rowCount: 4 };
          }
          if (/INSERT INTO contract_notification_queue/i.test(sql)) {
            scheduled++;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const result = await service.extendContract(
      TENANT_A,
      CONTRACT_ID,
      '2026-12-31',
      'verlenging',
      { userId: USER_A }
    );
    expect(result.contract.end_date).toBe('2026-12-31');
    expect(result.contract.status).toBe('active');
    expect(extInserted).toBe(true);
    expect(deletedPending).toBe(true);
    expect(scheduled).toBe(4);
  });

  it('rejects extension on terminated contract', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return {
              rows: [existingContractRow({ status: 'terminated' })],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.extendContract(TENANT_A, CONTRACT_ID, '2026-12-31', null, {})
    ).rejects.toMatchObject({ code: 'CONTRACT_TERMINATED' });
  });

  it('rejects extension when new_end_date <= current end_date', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return { rows: [existingContractRow()], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.extendContract(TENANT_A, CONTRACT_ID, '2026-06-30', null, {})
    ).rejects.toMatchObject({ code: 'EXTENSION_NOT_LATER' });
  });

  it('rejects extension on contract without end_date', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return {
              rows: [existingContractRow({ end_date: null })],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.extendContract(TENANT_A, CONTRACT_ID, '2027-01-01', null, {})
    ).rejects.toMatchObject({ code: 'NO_END_DATE' });
  });
});

describe('terminateContract', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('cancels pending notification rows and writes audit', async () => {
    let pendingDeleted = false;
    let auditAction: string | null = null;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return { rows: [existingContractRow()], rowCount: 1 };
          }
          if (/UPDATE contracts/i.test(sql)) {
            return {
              rows: [
                existingContractRow({
                  status: 'terminated',
                  termination_reason: params[0] as string,
                  terminated_at: nowIso(),
                }),
              ],
              rowCount: 1,
            };
          }
          if (/DELETE FROM contract_notification_queue/i.test(sql)) {
            pendingDeleted = true;
            return { rows: [], rowCount: 4 };
          }
          if (/INSERT INTO audit_events/i.test(sql)) {
            auditAction = params[2] as string;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const c = await service.terminateContract(
      TENANT_A,
      CONTRACT_ID,
      'mutual agreement',
      { userId: USER_A }
    );
    expect(c.status).toBe('terminated');
    expect(c.termination_reason).toBe('mutual agreement');
    expect(pendingDeleted).toBe(true);
    expect(auditAction).toBe('contract.terminated');
  });

  it('rejects when reason missing', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.terminateContract(TENANT_A, CONTRACT_ID, '   ')
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects double termination', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return {
              rows: [existingContractRow({ status: 'terminated' })],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.terminateContract(TENANT_A, CONTRACT_ID, 'reden')
    ).rejects.toMatchObject({ code: 'ALREADY_TERMINATED' });
  });
});

describe('listContracts', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns rows + null next_cursor when below limit', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return {
              rows: [existingContractRow(), existingContractRow({ id: 'c-2' })],
              rowCount: 2,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const result = await service.listContracts(TENANT_A, { limit: 10 });
    expect(result.data.length).toBe(2);
    expect(result.next_cursor).toBeNull();
  });

  it('returns next_cursor when more rows present', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            // limit+1 rows (3) when limit=2 → cursor returned
            return {
              rows: [
                existingContractRow({ id: 'c-1' }),
                existingContractRow({ id: 'c-2' }),
                existingContractRow({ id: 'c-3' }),
              ],
              rowCount: 3,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const result = await service.listContracts(TENANT_A, { limit: 2 });
    expect(result.data.length).toBe(2);
    expect(result.next_cursor).not.toBeNull();
  });
});

describe('scheduleExpiryNotifications idempotency', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('uses ON CONFLICT to upsert (idempotent across calls)', async () => {
    let onConflictUsed = 0;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return { rows: [existingContractRow()], rowCount: 1 };
          }
          if (/SELECT \* FROM contract_extensions/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/INSERT INTO contract_notification_queue/i.test(sql)) {
            if (/ON CONFLICT/i.test(sql)) onConflictUsed++;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await service.scheduleExpiryNotifications(TENANT_A, CONTRACT_ID);
    expect(onConflictUsed).toBe(4);
  });
});

describe('recomputeMargins', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('recalculates and writes margin for matching rows', async () => {
    let updates = 0;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT id, hourly_rate_candidate/i.test(sql)) {
            return {
              rows: [
                { id: 'c-1', hourly_rate_candidate: 25, hourly_rate_client: 50 },
                { id: 'c-2', hourly_rate_candidate: 40, hourly_rate_client: 80 },
              ],
              rowCount: 2,
            };
          }
          if (/UPDATE contracts/i.test(sql)) {
            updates++;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const n = await service.recomputeMargins(TENANT_A);
    expect(n).toBe(2);
    expect(updates).toBe(2);
  });
});

describe('getContract not found', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('throws 404 when contract row missing', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.getContract(TENANT_A, CONTRACT_ID)
    ).rejects.toMatchObject({ code: 'CONTRACT_NOT_FOUND' });
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import * as service from '../../src/modules/timesheets/timesheets.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const CONTRACT_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const TS_ID = '44444444-4444-4444-4444-444444444444';
const APPROVER_ID = '55555555-5555-5555-5555-555555555555';

function tsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TS_ID,
    tenant_id: TENANT_A,
    contract_id: CONTRACT_ID,
    candidate_id: CAND_ID,
    week_start: '2026-05-04',
    week_end: '2026-05-10',
    status: 'draft',
    total_hours: 0,
    total_overtime_hours: 0,
    notes: null,
    submitted_at: null,
    approved_at: null,
    approved_by: null,
    rejected_at: null,
    rejection_reason: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function contractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTRACT_ID,
    tenant_id: TENANT_A,
    candidate_id: CAND_ID,
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
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('getOrCreateTimesheet', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns existing row when present', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow()], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const ts = await service.getOrCreateTimesheet(
      TENANT_A,
      CONTRACT_ID,
      '2026-05-04',
      CAND_ID
    );
    expect(ts.id).toBe(TS_ID);
  });

  it('inserts a new row when not present', async () => {
    let inserted = false;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/INSERT INTO timesheets/i.test(sql)) {
            inserted = true;
            return { rows: [tsRow()], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const ts = await service.getOrCreateTimesheet(
      TENANT_A,
      CONTRACT_ID,
      '2026-05-04',
      CAND_ID
    );
    expect(inserted).toBe(true);
    expect(ts.week_end).toBe('2026-05-10');
  });

  it('rejects when week_start missing', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.getOrCreateTimesheet(TENANT_A, CONTRACT_ID, '', CAND_ID)
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('addOrUpdateEntry', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('inserts an entry when none exists for that date', async () => {
    let entryInserted = false;
    let totalsUpdated = false;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow()], rowCount: 1 };
          }
          if (/SELECT \* FROM timesheet_entries/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/INSERT INTO timesheet_entries/i.test(sql)) {
            entryInserted = true;
            return {
              rows: [
                {
                  id: 'e-1',
                  tenant_id: TENANT_A,
                  timesheet_id: TS_ID,
                  date: params[2],
                  hours: params[3],
                  overtime_hours: params[4] ?? 0,
                  break_minutes: params[5] ?? 0,
                  description: params[6] ?? null,
                  project_code: params[7] ?? null,
                  created_at: new Date().toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          if (/SUM\(hours\)/i.test(sql)) {
            return {
              rows: [{ total_hours: 8, total_overtime_hours: 0 }],
              rowCount: 1,
            };
          }
          if (/UPDATE timesheets/i.test(sql)) {
            totalsUpdated = true;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const result = await service.addOrUpdateEntry(
      TENANT_A,
      TS_ID,
      { date: '2026-05-05', hours: 8 },
      { userId: CAND_ID, role: 'candidate' }
    );
    expect(entryInserted).toBe(true);
    expect(totalsUpdated).toBe(true);
    expect(result.totals.total_hours).toBe(8);
  });

  it('rejects entries on submitted timesheet', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'submitted' })], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.addOrUpdateEntry(TENANT_A, TS_ID, { date: '2026-05-05', hours: 4 })
    ).rejects.toMatchObject({ code: 'TIMESHEET_LOCKED' });
  });

  it('reverts a rejected timesheet back to draft when re-edited', async () => {
    let revertedToDraft = false;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'rejected' })], rowCount: 1 };
          }
          if (/SELECT \* FROM timesheet_entries/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/INSERT INTO timesheet_entries/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'e-1',
                  tenant_id: TENANT_A,
                  timesheet_id: TS_ID,
                  date: '2026-05-06',
                  hours: 6,
                  overtime_hours: 0,
                  break_minutes: 0,
                  description: null,
                  project_code: null,
                  created_at: new Date().toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          if (/SUM\(hours\)/i.test(sql)) {
            return {
              rows: [{ total_hours: 6, total_overtime_hours: 0 }],
              rowCount: 1,
            };
          }
          if (/UPDATE timesheets/i.test(sql)) {
            if (/status = 'draft'/i.test(sql)) revertedToDraft = true;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await service.addOrUpdateEntry(TENANT_A, TS_ID, {
      date: '2026-05-06',
      hours: 6,
    });
    expect(revertedToDraft).toBe(true);
  });

  it('rejects entries with date outside week', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow()], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.addOrUpdateEntry(TENANT_A, TS_ID, {
        date: '2026-05-20',
        hours: 4,
      })
    ).rejects.toMatchObject({ code: 'DATE_OUT_OF_RANGE' });
  });

  it('validates hours range', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.addOrUpdateEntry(TENANT_A, TS_ID, {
        date: '2026-05-05',
        hours: 25,
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('submitTimesheet', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('moves draft → submitted', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'draft' })], rowCount: 1 };
          }
          if (/UPDATE timesheets/i.test(sql)) {
            return {
              rows: [tsRow({ status: 'submitted', submitted_at: new Date().toISOString() })],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const ts = await service.submitTimesheet(TENANT_A, TS_ID, CAND_ID);
    expect(ts.status).toBe('submitted');
    expect(ts.submitted_at).toBeTruthy();
  });

  it('rejects from non-draft state', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'submitted' })], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.submitTimesheet(TENANT_A, TS_ID, CAND_ID)
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('rejects when wrong candidate submits', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow()], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.submitTimesheet(
        TENANT_A,
        TS_ID,
        '99999999-9999-9999-9999-999999999999'
      )
    ).rejects.toMatchObject({ code: 'WRONG_CANDIDATE' });
  });
});

describe('approveTimesheet', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('admin can approve a submitted timesheet', async () => {
    let auditRow: { actor_role: string | null } | null = null;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'submitted' })], rowCount: 1 };
          }
          if (/UPDATE timesheets/i.test(sql)) {
            return {
              rows: [
                tsRow({
                  status: 'approved',
                  approved_by: APPROVER_ID,
                  approved_at: new Date().toISOString(),
                }),
              ],
              rowCount: 1,
            };
          }
          if (/INSERT INTO timesheet_audit/i.test(sql)) {
            auditRow = { actor_role: params[3] as string | null };
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const ts = await service.approveTimesheet(
      TENANT_A,
      TS_ID,
      APPROVER_ID,
      'admin'
    );
    expect(ts.status).toBe('approved');
    expect(auditRow?.actor_role).toBe('admin');
  });

  it('client role can approve', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'submitted' })], rowCount: 1 };
          }
          if (/UPDATE timesheets/i.test(sql)) {
            return {
              rows: [tsRow({ status: 'approved', approved_by: APPROVER_ID })],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const ts = await service.approveTimesheet(
      TENANT_A,
      TS_ID,
      APPROVER_ID,
      'client'
    );
    expect(ts.status).toBe('approved');
  });

  it('candidate role cannot approve', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.approveTimesheet(TENANT_A, TS_ID, APPROVER_ID, 'candidate')
    ).rejects.toMatchObject({ code: 'APPROVER_FORBIDDEN' });
  });

  it('rejects approval from wrong state', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'draft' })], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.approveTimesheet(TENANT_A, TS_ID, APPROVER_ID, 'admin')
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('rejectTimesheet', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('moves submitted → rejected with reason', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'submitted' })], rowCount: 1 };
          }
          if (/UPDATE timesheets/i.test(sql)) {
            return {
              rows: [
                tsRow({
                  status: 'rejected',
                  rejected_at: new Date().toISOString(),
                  rejection_reason: params[0] as string,
                }),
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const ts = await service.rejectTimesheet(
      TENANT_A,
      TS_ID,
      APPROVER_ID,
      'incomplete data'
    );
    expect(ts.status).toBe('rejected');
    expect(ts.rejection_reason).toBe('incomplete data');
  });

  it('rejects when reason missing', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.rejectTimesheet(TENANT_A, TS_ID, APPROVER_ID, '   ')
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('disputeTimesheet', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('cannot dispute a draft', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow()], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.disputeTimesheet(TENANT_A, TS_ID, APPROVER_ID, 'wrong hours')
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('cannot dispute an approved timesheet', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'approved' })], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.disputeTimesheet(TENANT_A, TS_ID, APPROVER_ID, 'changed mind')
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('moves submitted → disputed with reason', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'submitted' })], rowCount: 1 };
          }
          if (/UPDATE timesheets/i.test(sql)) {
            return {
              rows: [tsRow({ status: 'disputed' })],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const ts = await service.disputeTimesheet(
      TENANT_A,
      TS_ID,
      APPROVER_ID,
      'wrong hours'
    );
    expect(ts.status).toBe('disputed');
  });
});

describe('summarizeApprovedHoursForBilling', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('aggregates regular + 1.5x overtime across multiple weeks', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return { rows: [contractRow()], rowCount: 1 };
          }
          if (/FROM contract_extensions/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/FROM timesheets/i.test(sql)) {
            return {
              rows: [
                {
                  id: 't-1',
                  week_start: '2026-05-04',
                  week_end: '2026-05-10',
                  total_hours: 40,
                  total_overtime_hours: 4,
                },
                {
                  id: 't-2',
                  week_start: '2026-05-11',
                  week_end: '2026-05-17',
                  total_hours: 36,
                  total_overtime_hours: 0,
                },
              ],
              rowCount: 2,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const summary = await service.summarizeApprovedHoursForBilling(
      TENANT_A,
      CONTRACT_ID,
      '2026-05-01',
      '2026-05-31'
    );
    // candidate rate=25, client rate=50, OT mult=1.5
    // week1 cand: 40*25 + 4*25*1.5 = 1000 + 150 = 1150
    // week2 cand: 36*25 + 0       = 900
    // total cand: 2050
    expect(summary.total_hours).toBe(76);
    expect(summary.total_overtime_hours).toBe(4);
    expect(summary.total_amount_candidate).toBe(2050);
    // total client: 40*50 + 4*50*1.5 + 36*50 = 2000 + 300 + 1800 = 4100
    expect(summary.total_amount_client).toBe(4100);
    expect(summary.currency).toBe('EUR');
    expect(summary.by_week).toHaveLength(2);
  });

  it('respects custom overtime_multiplier from contract metadata', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return {
              rows: [
                contractRow({
                  metadata: { overtime_multiplier: 2 },
                }),
              ],
              rowCount: 1,
            };
          }
          if (/FROM contract_extensions/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/FROM timesheets/i.test(sql)) {
            return {
              rows: [
                {
                  id: 't-1',
                  week_start: '2026-05-04',
                  week_end: '2026-05-10',
                  total_hours: 40,
                  total_overtime_hours: 5,
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const summary = await service.summarizeApprovedHoursForBilling(
      TENANT_A,
      CONTRACT_ID,
      '2026-05-01',
      '2026-05-31'
    );
    // cand: 40*25 + 5*25*2 = 1000 + 250 = 1250
    expect(summary.total_amount_candidate).toBe(1250);
  });

  it('rejects when period_start > period_end', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.summarizeApprovedHoursForBilling(
        TENANT_A,
        CONTRACT_ID,
        '2026-05-31',
        '2026-05-01'
      )
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
  });

  it('returns zeros when no approved timesheets in period', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return { rows: [contractRow()], rowCount: 1 };
          }
          if (/FROM contract_extensions/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/FROM timesheets/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const summary = await service.summarizeApprovedHoursForBilling(
      TENANT_A,
      CONTRACT_ID,
      '2026-05-01',
      '2026-05-31'
    );
    expect(summary.total_hours).toBe(0);
    expect(summary.total_amount_client).toBe(0);
    expect(summary.by_week).toHaveLength(0);
  });
});

describe('Portal token issuance + resolution', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('createPortalToken returns the raw token + persists hash', async () => {
    let storedHash: string | null = null;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/INSERT INTO timesheet_portal_tokens/i.test(sql)) {
            storedHash = params[3] as string;
            return {
              rows: [
                {
                  id: 'tok-1',
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const result = await service.createPortalToken(
      TENANT_A,
      CONTRACT_ID,
      CAND_ID
    );
    expect(result.token).toBeTruthy();
    expect(storedHash).not.toBe(result.token);
    // sha256 hex length 64
    expect(storedHash?.length).toBe(64);
  });

  it('resolvePortalToken returns null for unknown token', async () => {
    teardown = installPoolMock(mockClient());
    const r = await service.resolvePortalToken('nonexistent-token');
    expect(r).toBeNull();
  });

  it('resolvePortalToken returns null for expired token', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM timesheet_portal_tokens/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'tok-1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  candidate_id: CAND_ID,
                  expires_at: new Date(Date.now() - 86400000).toISOString(),
                  revoked_at: null,
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const r = await service.resolvePortalToken('any-token');
    expect(r).toBeNull();
  });

  it('resolvePortalToken returns null for revoked token', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM timesheet_portal_tokens/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'tok-1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  candidate_id: CAND_ID,
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  revoked_at: new Date().toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const r = await service.resolvePortalToken('any-token');
    expect(r).toBeNull();
  });
});

/**
 * Commissions service tests — Sprint Q4.4 (Agent UUU).
 *
 * Cover scheme types (math), share splits, state machine, cross-tenant.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/queue/queues', () => ({
  jobBoardPostQueue: { add: vi.fn(async () => ({ id: 'mock' })) },
  jobBoardPollQueue: { add: vi.fn(async () => ({ id: 'mock' })) },
}));

import * as service from '../../src/modules/commissions/commissions.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const TENANT2 = '22222222-2222-2222-2222-222222222222';

describe('commissions.computeCommissionAmount — pure math', () => {
  it('flat scheme returns config.amount unchanged', () => {
    expect(
      service.computeCommissionAmount(
        { type: 'flat', config: { amount: 250 } },
        10000
      )
    ).toBe(250);
  });

  it('percent_of_fee = base × percent / 100', () => {
    expect(
      service.computeCommissionAmount(
        { type: 'percent_of_fee', config: { percent: 12 } },
        5000
      )
    ).toBe(600);
  });

  it('percent_of_margin = base × percent / 100', () => {
    expect(
      service.computeCommissionAmount(
        { type: 'percent_of_margin', config: { percent: 25 } },
        2000
      )
    ).toBe(500);
  });

  it('tiered: applies progressive percentages', () => {
    const tiers = {
      tiers: [
        { up_to: 1000, percent: 5 },
        { up_to: 5000, percent: 10 },
        { up_to: null, percent: 15 },
      ],
    };
    // base 7000 → 1000@5%=50 + 4000@10%=400 + 2000@15%=300 → 750
    expect(
      service.computeCommissionAmount({ type: 'tiered', config: tiers }, 7000)
    ).toBe(750);
  });

  it('tiered with empty tiers returns 0', () => {
    expect(
      service.computeCommissionAmount({ type: 'tiered', config: { tiers: [] } }, 1000)
    ).toBe(0);
  });

  it('recurring_monthly counts full calendar months in period', () => {
    const r = service.computeCommissionAmount(
      { type: 'recurring_monthly', config: { amount: 100 } },
      0,
      '2026-04-01',
      '2026-06-30'
    );
    // 3 full months (Apr, May, Jun) → 300
    expect(r).toBe(300);
  });

  it('recurring_monthly returns single payment for sub-month period', () => {
    const r = service.computeCommissionAmount(
      { type: 'recurring_monthly', config: { amount: 100 } },
      0,
      '2026-04-10',
      '2026-04-20'
    );
    expect(r).toBe(100);
  });

  it('returns 0 for unknown type', () => {
    expect(
      service.computeCommissionAmount(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { type: 'mystery' as any, config: {} },
        1000
      )
    ).toBe(0);
  });
});

describe('commissions.recordCommissionsForInvoice', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('creates one record per active assignment, scaled by share_percent', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/SELECT id, contract_id, subtotal_amount, period_start, period_end[^]*FROM invoices/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'inv-1',
                  contract_id: 'c-1',
                  subtotal_amount: '10000',
                  period_start: '2026-04-01',
                  period_end: '2026-04-30',
                },
              ],
              rowCount: 1,
            };
          }
          if (/SUM\(t\.total_hours/i.test(sql)) {
            return { rows: [{ candidate_total: '6000' }], rowCount: 1 };
          }
          if (/FROM commission_assignments/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'a-1',
                  recruiter_id: 'r-1',
                  contract_id: 'c-1',
                  share_percent: '60',
                  scheme_type: 'percent_of_fee',
                  scheme_config: { percent: 10 },
                },
                {
                  id: 'a-2',
                  recruiter_id: 'r-2',
                  contract_id: 'c-1',
                  share_percent: '40',
                  scheme_type: 'percent_of_margin',
                  scheme_config: { percent: 25 },
                },
              ],
              rowCount: 2,
            };
          }
          if (/INSERT INTO commission_records/i.test(sql)) {
            const rec = {
              id: `r-${inserts.length}`,
              tenant_id: params[0],
              assignment_id: params[1],
              recruiter_id: params[2],
              contract_id: params[3],
              invoice_id: params[4],
              base_amount: params[5],
              commission_amount: params[6],
              period_start: params[7],
              period_end: params[8],
              status: 'pending',
              paid_at: null,
              created_at: new Date().toISOString(),
            };
            inserts.push(rec);
            return { rows: [rec], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );

    const records = await service.recordCommissionsForInvoice(TENANT, 'inv-1');
    expect(records).toHaveLength(2);
    // a-1: percent_of_fee 10% on 10000 base = 1000, × 60% share = 600
    // a-2: percent_of_margin 25% on (10000-6000)=4000 base = 1000, × 40% share = 400
    expect(Number(inserts[0].commission_amount)).toBeCloseTo(600, 2);
    expect(Number(inserts[1].commission_amount)).toBeCloseTo(400, 2);
  });

  it('returns [] when invoice has no contract_id', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT id, contract_id, subtotal_amount, period_start, period_end[^]*FROM invoices/i.test(sql)) {
            return {
              rows: [{ id: 'inv-1', contract_id: null, subtotal_amount: '0', period_start: null, period_end: null }],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const records = await service.recordCommissionsForInvoice(TENANT, 'inv-1');
    expect(records).toEqual([]);
  });
});

describe('commissions state machine', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  function makeRecord(status: string) {
    return {
      id: 'r-1',
      tenant_id: TENANT,
      assignment_id: 'a-1',
      recruiter_id: 'rec-1',
      contract_id: 'c-1',
      invoice_id: 'inv-1',
      base_amount: '1000',
      commission_amount: '100',
      period_start: null,
      period_end: null,
      status,
      paid_at: null,
      created_at: new Date().toISOString(),
    };
  }

  it('approve: pending → approved', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM commission_records/i.test(sql))
            return { rows: [makeRecord('pending')], rowCount: 1 };
          if (/UPDATE commission_records/i.test(sql))
            return { rows: [makeRecord('approved')], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const r = await service.approveCommission(TENANT, 'r-1');
    expect(r.status).toBe('approved');
  });

  it('cannot approve a paid record', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM commission_records/i.test(sql))
            return { rows: [makeRecord('paid')], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.approveCommission(TENANT, 'r-1')
    ).rejects.toMatchObject({ code: 'INVALID_COMMISSION_TRANSITION' });
  });

  it('pay: approved → paid sets paid_at', async () => {
    let captured: { extra: string } | null = null;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM commission_records/i.test(sql))
            return { rows: [makeRecord('approved')], rowCount: 1 };
          if (/UPDATE commission_records/i.test(sql)) {
            const includesPaidAt = /paid_at = now\(\)/.test(sql);
            captured = { extra: includesPaidAt ? 'paid_at_set' : 'no' };
            return { rows: [{ ...makeRecord('paid'), paid_at: new Date().toISOString() }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const r = await service.payCommission(TENANT, 'r-1');
    expect(r.status).toBe('paid');
    expect(captured?.extra).toBe('paid_at_set');
  });

  it('dispute: pending → disputed with reason', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM commission_records/i.test(sql))
            return { rows: [makeRecord('pending')], rowCount: 1 };
          if (/UPDATE commission_records/i.test(sql))
            return { rows: [makeRecord('disputed')], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const r = await service.disputeCommission(TENANT, 'r-1', 'wrong amount');
    expect(r.status).toBe('disputed');
  });
});

describe('commissions.assignToContract — validation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('rejects share_percent > 100', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.assignToContract(TENANT, {
        contract_id: '00000000-0000-0000-0000-000000000001',
        recruiter_id: '00000000-0000-0000-0000-000000000002',
        scheme_id: '00000000-0000-0000-0000-000000000003',
        share_percent: 150,
      })
    ).rejects.toMatchObject({ code: 'INVALID_SHARE_PERCENT' });
  });

  it('rejects unknown scheme_id', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM commission_schemes/i.test(sql))
            return { rows: [], rowCount: 0 };
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await expect(
      service.assignToContract(TENANT, {
        contract_id: '00000000-0000-0000-0000-000000000001',
        recruiter_id: '00000000-0000-0000-0000-000000000002',
        scheme_id: '00000000-0000-0000-0000-000000000099',
      })
    ).rejects.toMatchObject({ code: 'SCHEME_NOT_FOUND' });
  });
});

describe('commissions cross-tenant isolation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('listSchemes calls SET LOCAL with the right tenant', async () => {
    const observed: string[] = [];
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          const m = sql.match(/SET LOCAL app\.tenant_id = '([0-9a-f-]{36})'/i);
          if (m) observed.push(m[1]);
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await service.listSchemes(TENANT);
    await service.listSchemes(TENANT2);
    expect(observed).toContain(TENANT);
    expect(observed).toContain(TENANT2);
  });
});

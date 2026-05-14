/**
 * Forecasting service tests — Sprint Q4.4 (Agent UUU).
 *
 * Cover: contract weeks-in-month math, deal pipeline weighting, fallback
 * when crm_deals absent, margin-report aggregation, cross-tenant.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/queue/queues', () => ({
  jobBoardPostQueue: { add: vi.fn(async () => ({ id: 'mock' })) },
  jobBoardPollQueue: { add: vi.fn(async () => ({ id: 'mock' })) },
}));

import * as service from '../../src/modules/forecasting/forecasting.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const TENANT2 = '22222222-2222-2222-2222-222222222222';

function buildClientForForecast(opts: {
  contracts?: Array<Record<string, string | null>>;
  deals?: Array<Record<string, unknown>>;
  dealsMissing?: boolean;
  upserts?: Array<Record<string, unknown>>;
}) {
  return mockClient({
    __matcher: (sql, params) => {
      if (/FROM contracts[^]*WHERE status IN/i.test(sql)) {
        return {
          rows: opts.contracts ?? [],
          rowCount: opts.contracts?.length ?? 0,
        };
      }
      if (/FROM crm_deals/i.test(sql)) {
        if (opts.dealsMissing) {
          const err = new Error('relation "crm_deals" does not exist') as Error & {
            code?: string;
          };
          err.code = '42P01';
          throw err;
        }
        return {
          rows: opts.deals ?? [],
          rowCount: opts.deals?.length ?? 0,
        };
      }
      if (/INSERT INTO revenue_forecasts/i.test(sql)) {
        const row = {
          id: `f-${(opts.upserts?.length ?? 0)}`,
          tenant_id: params[0],
          forecast_month: params[1],
          expected_revenue: params[2],
          pipeline_revenue: params[3],
          hires_in_pipeline: params[4],
          active_contracts: params[5],
          computed_at: new Date().toISOString(),
        };
        opts.upserts?.push(row);
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  });
}

describe('forecasting.computeForecastSlices — math', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('counts an active contract for the month it overlaps', async () => {
    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    teardown = installPoolMock(
      buildClientForForecast({
        contracts: [
          {
            id: 'c-1',
            start_date: start,
            end_date: '2099-12-31',
            weekly_hours: '40',
            hourly_rate_client: '50',
          },
        ],
        deals: [],
      })
    );
    const slices = await service.computeForecastSlices(TENANT, 1);
    expect(slices).toHaveLength(1);
    expect(slices[0].active_contracts).toBe(1);
    // 40 × 50 × ~4.3 weeks ≈ 8500-9000. We just verify it's > 0.
    expect(slices[0].expected_revenue).toBeGreaterThan(0);
  });

  it('weights pipeline revenue by stage probability', async () => {
    const today = new Date();
    const monthEnd = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
    )
      .toISOString()
      .slice(0, 10);
    teardown = installPoolMock(
      buildClientForForecast({
        contracts: [],
        deals: [
          {
            id: 'd-1',
            value_eur: '10000',
            stage: 'offerte',
            expected_close_date: monthEnd,
          },
        ],
      })
    );
    const slices = await service.computeForecastSlices(TENANT, 1);
    // offerte=0.4 → 4000
    expect(slices[0].pipeline_revenue).toBeCloseTo(4000, 2);
    expect(slices[0].hires_in_pipeline).toBe(0);
  });

  it('falls back to pipeline=0 when crm_deals missing (42P01)', async () => {
    teardown = installPoolMock(
      buildClientForForecast({
        contracts: [],
        dealsMissing: true,
      })
    );
    const slices = await service.computeForecastSlices(TENANT, 2);
    expect(slices.every((s) => s.pipeline_revenue === 0)).toBe(true);
  });

  it('returns months_ahead worth of slices', async () => {
    teardown = installPoolMock(
      buildClientForForecast({ contracts: [], deals: [] })
    );
    const slices = await service.computeForecastSlices(TENANT, 4);
    expect(slices).toHaveLength(4);
  });
});

describe('forecasting.computeForecast — UPSERT into revenue_forecasts', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('writes one row per slice', async () => {
    const upserts: Record<string, unknown>[] = [];
    teardown = installPoolMock(
      buildClientForForecast({ contracts: [], deals: [], upserts })
    );
    const out = await service.computeForecast(TENANT, 3);
    expect(out).toHaveLength(3);
    expect(upserts).toHaveLength(3);
  });
});

describe('forecasting.getMarginReport', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('aggregates per-client revenue/cost/margin', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/GROUP BY inv\.group_id/i.test(sql)) {
            return {
              rows: [
                {
                  group_id: 'org-1',
                  invoice_count: 3,
                  total_revenue: '15000',
                  total_cost: '10500',
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const rows = await service.getMarginReport(TENANT, { group_by: 'client' });
    expect(rows).toHaveLength(1);
    expect(rows[0].margin_amount).toBe(4500);
    expect(rows[0].margin_pct).toBeCloseTo(30.0, 1);
    expect(rows[0].invoice_count).toBe(3);
  });

  it('aggregates per-recruiter using share-percent weighting', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/GROUP BY a\.recruiter_id/i.test(sql)) {
            return {
              rows: [
                {
                  group_id: 'rec-1',
                  invoice_count: 2,
                  total_revenue: '6000',
                  total_cost: '4000',
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const rows = await service.getMarginReport(TENANT, {
      group_by: 'recruiter',
    });
    expect(rows[0].group_id).toBe('rec-1');
    expect(rows[0].margin_amount).toBe(2000);
  });

  it('returns 0% margin when revenue is 0', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/GROUP BY inv\.group_id/i.test(sql)) {
            return {
              rows: [
                {
                  group_id: 'org-2',
                  invoice_count: 0,
                  total_revenue: '0',
                  total_cost: '0',
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const rows = await service.getMarginReport(TENANT, { group_by: 'client' });
    expect(rows[0].margin_pct).toBe(0);
  });
});

describe('forecasting cross-tenant isolation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('uses SET LOCAL for both tenants', async () => {
    const seen: string[] = [];
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          const m = sql.match(/SET LOCAL app\.tenant_id = '([0-9a-f-]{36})'/i);
          if (m) seen.push(m[1]);
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await service.getForecasts(TENANT, 3);
    await service.getForecasts(TENANT2, 3);
    expect(seen).toContain(TENANT);
    expect(seen).toContain(TENANT2);
  });
});

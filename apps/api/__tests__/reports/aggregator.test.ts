import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  aggregateBlock,
} from '../../src/lib/reports/aggregator';
import {
  AVAILABLE_DIMENSIONS,
  AVAILABLE_METRICS,
  type ReportBlockEntry,
} from '../../src/lib/reports/configSchema';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

const TENANT = '11111111-1111-1111-1111-111111111111';
const DATE_RANGE = {
  from: new Date('2025-01-01T00:00:00Z'),
  to: new Date('2025-04-30T23:59:59Z'),
};

const dim = (key: string) => {
  const d = AVAILABLE_DIMENSIONS.find((x) => x.key === key)!;
  return { key: d.key, entity: d.entity, label: d.label };
};
const met = (key: string) => {
  const m = AVAILABLE_METRICS.find((x) => x.key === key)!;
  return { key: m.key, entity: m.entity, label: m.label, unit: m.unit };
};

describe('aggregator', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('aggregateKpi returns single value', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [{ value: 42 }], rowCount: 1 };
      },
    });
    teardown = installPoolMock(client);

    const blockEntry: ReportBlockEntry = {
      id: 'k1',
      title: 'Aantal kandidaten',
      size: 'sm',
      block: { type: 'kpi', metric: met('count') },
    };

    const out = await aggregateBlock({
      tenantId: TENANT,
      blockEntry,
      dateRange: DATE_RANGE,
    });

    expect(out.result.block_type).toBe('kpi');
    if (out.result.block_type === 'kpi') {
      expect(out.result.value).toBe(42);
      expect(out.result.metric_label).toBe('Aantal');
    }
  });

  it('aggregateKpi with comparison fires 2 queries and computes delta_pct', async () => {
    let callIdx = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        callIdx++;
        // 1st call = current period, 2nd = previous period
        return { rows: [{ value: callIdx === 1 ? 200 : 100 }], rowCount: 1 };
      },
    });
    teardown = installPoolMock(client);

    const blockEntry: ReportBlockEntry = {
      id: 'k1',
      size: 'sm',
      block: { type: 'kpi', metric: met('count'), comparison: 'previous_period' },
    };

    const out = await aggregateBlock({
      tenantId: TENANT,
      blockEntry,
      dateRange: DATE_RANGE,
    });

    if (out.result.block_type === 'kpi') {
      expect(out.result.value).toBe(200);
      expect(out.result.comparison_value).toBe(100);
      expect(out.result.comparison_delta_pct).toBe(100);
    }
  });

  it('aggregateTable returns headers + rows for flat table', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            { dim_recruiter: 'Sarah', metric: 12 },
            { dim_recruiter: 'Thomas', metric: 7 },
          ],
          rowCount: 2,
        };
      },
    });
    teardown = installPoolMock(client);

    const blockEntry: ReportBlockEntry = {
      id: 't1',
      title: 'Hires per recruiter',
      size: 'md',
      block: {
        type: 'table',
        rows: [dim('recruiter')],
        metric: met('hire_count'),
      },
    };

    const out = await aggregateBlock({
      tenantId: TENANT,
      blockEntry,
      dateRange: DATE_RANGE,
    });

    expect(out.result.block_type).toBe('table');
    if (out.result.block_type === 'table') {
      expect(out.result.headers).toEqual(['Recruiter', 'Aantal hires']);
      expect(out.result.rows.length).toBe(2);
      expect(out.result.rows[0]).toEqual(['Sarah', 12]);
    }
  });

  it('aggregateTable does cross-tab pivot when cols provided', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            { dim_recruiter: 'Sarah', dim_source: 'LinkedIn', metric: 5 },
            { dim_recruiter: 'Sarah', dim_source: 'Indeed', metric: 3 },
            { dim_recruiter: 'Thomas', dim_source: 'LinkedIn', metric: 2 },
          ],
          rowCount: 3,
        };
      },
    });
    teardown = installPoolMock(client);

    const blockEntry: ReportBlockEntry = {
      id: 't1',
      size: 'lg',
      block: {
        type: 'table',
        rows: [dim('recruiter')],
        cols: [dim('source')],
        metric: met('hire_count'),
      },
    };
    const out = await aggregateBlock({
      tenantId: TENANT,
      blockEntry,
      dateRange: DATE_RANGE,
    });
    if (out.result.block_type === 'table') {
      // Headers = row-dim labels + sorted col keys
      expect(out.result.headers[0]).toBe('Recruiter');
      expect(out.result.headers).toContain('LinkedIn');
      expect(out.result.headers).toContain('Indeed');
      expect(out.result.rows.length).toBe(2);
    }
  });

  it('aggregateBar returns points per x-value', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            { x: 'LinkedIn', application_count: 50 },
            { x: 'Indeed', application_count: 30 },
          ],
          rowCount: 2,
        };
      },
    });
    teardown = installPoolMock(client);

    const blockEntry: ReportBlockEntry = {
      id: 'b1',
      size: 'md',
      block: {
        type: 'bar',
        x: dim('source'),
        series: [met('application_count')],
      },
    };
    const out = await aggregateBlock({
      tenantId: TENANT,
      blockEntry,
      dateRange: DATE_RANGE,
    });
    expect(out.result.block_type).toBe('bar');
    if (out.result.block_type === 'bar') {
      expect(out.result.points.length).toBe(2);
      expect(out.result.x_label).toBe('Bron');
    }
  });

  it('aggregateFunnel computes per-stage conversion', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [{ stage_0: 100, stage_1: 60, stage_2: 20 }],
          rowCount: 1,
        };
      },
    });
    teardown = installPoolMock(client);

    const blockEntry: ReportBlockEntry = {
      id: 'f1',
      size: 'lg',
      block: {
        type: 'funnel',
        entity: 'applications',
        stages: ['Applied', 'Phone', 'Hired'],
      },
    };
    const out = await aggregateBlock({
      tenantId: TENANT,
      blockEntry,
      dateRange: DATE_RANGE,
    });
    if (out.result.block_type === 'funnel') {
      expect(out.result.stages[0].count).toBe(100);
      expect(out.result.stages[0].conversion_pct).toBe(100);
      expect(out.result.stages[1].count).toBe(60);
      expect(out.result.stages[1].conversion_pct).toBe(60);
      expect(out.result.stages[2].conversion_pct).toBe(20);
    }
  });

  it('aggregatePie returns slices with pct', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            { label: 'LinkedIn', value: 80 },
            { label: 'Indeed', value: 20 },
          ],
          rowCount: 2,
        };
      },
    });
    teardown = installPoolMock(client);

    const blockEntry: ReportBlockEntry = {
      id: 'p1',
      size: 'md',
      block: {
        type: 'pie',
        metric: met('count'),
        group_by: dim('source'),
      },
    };
    const out = await aggregateBlock({
      tenantId: TENANT,
      blockEntry,
      dateRange: DATE_RANGE,
    });
    if (out.result.block_type === 'pie') {
      expect(out.result.slices.length).toBe(2);
      expect(out.result.slices[0].pct).toBe(80);
      expect(out.result.slices[1].pct).toBe(20);
    }
  });

  it('rejects unknown dimension', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    const blockEntry: ReportBlockEntry = {
      id: 'x1',
      size: 'md',
      block: {
        type: 'pie',
        metric: met('count'),
        group_by: { key: 'NOT_REAL', entity: 'candidates', label: '?' },
      },
    };
    await expect(
      aggregateBlock({
        tenantId: TENANT,
        blockEntry,
        dateRange: DATE_RANGE,
      })
    ).rejects.toThrow(/Unknown dimension/);
  });
});

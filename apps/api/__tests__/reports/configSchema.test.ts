import { describe, it, expect } from 'vitest';
import {
  validateReportConfig,
  resolveDateRange,
  AVAILABLE_DIMENSIONS,
  AVAILABLE_METRICS,
  type ReportConfig,
} from '../../src/lib/reports/configSchema';

const dim = (key: string) => {
  const d = AVAILABLE_DIMENSIONS.find((x) => x.key === key)!;
  return { key: d.key, entity: d.entity, label: d.label };
};
const met = (key: string) => {
  const m = AVAILABLE_METRICS.find((x) => x.key === key)!;
  return { key: m.key, entity: m.entity, label: m.label, unit: m.unit };
};

describe('configSchema.validateReportConfig', () => {
  it('rejects non-object input', () => {
    const r = validateReportConfig(null);
    expect(r.valid).toBe(false);
    expect(r.errors?.[0]).toMatch(/object vereist/);
  });

  it('requires blocks array with at least 1 block', () => {
    const r = validateReportConfig({
      date_range: { type: 'last_n_days', days: 7 },
      blocks: [],
    });
    expect(r.valid).toBe(false);
    expect(r.errors?.some((e) => /minimaal 1 block/.test(e))).toBe(true);
  });

  it('rejects unknown dimension keys', () => {
    const r = validateReportConfig({
      date_range: { type: 'last_n_days', days: 7 },
      blocks: [
        {
          id: 'b1',
          size: 'md',
          block: {
            type: 'pie',
            metric: met('count'),
            group_by: { key: 'NOT_REAL', entity: 'candidates', label: 'x' },
          },
        },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors?.some((e) => /onbekende dimension/.test(e))).toBe(true);
  });

  it('rejects unknown metric keys', () => {
    const r = validateReportConfig({
      date_range: { type: 'last_n_days', days: 7 },
      blocks: [
        {
          id: 'b1',
          size: 'sm',
          block: {
            type: 'kpi',
            metric: { key: 'foobar', entity: 'candidates', label: 'x' },
          },
        },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors?.some((e) => /onbekende metric/.test(e))).toBe(true);
  });

  it('accepts a valid kpi block', () => {
    const cfg: ReportConfig = {
      date_range: { type: 'last_n_days', days: 30 },
      blocks: [
        {
          id: 'k1',
          size: 'sm',
          block: {
            type: 'kpi',
            metric: met('count'),
            comparison: 'previous_period',
          },
        },
      ],
    };
    const r = validateReportConfig(cfg);
    expect(r.valid).toBe(true);
  });

  it('accepts a valid funnel with stages', () => {
    const cfg: ReportConfig = {
      date_range: { type: 'this_quarter' },
      blocks: [
        {
          id: 'f1',
          size: 'lg',
          block: {
            type: 'funnel',
            entity: 'applications',
            stages: ['New', 'Phone', 'Hire'],
          },
        },
      ],
    };
    expect(validateReportConfig(cfg).valid).toBe(true);
  });

  it('rejects funnel with <2 stages', () => {
    const r = validateReportConfig({
      date_range: { type: 'this_quarter' },
      blocks: [
        {
          id: 'f1',
          size: 'lg',
          block: { type: 'funnel', entity: 'applications', stages: ['Only'] },
        },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors?.some((e) => /minimaal 2 stages/.test(e))).toBe(true);
  });

  it('rejects duplicate block ids', () => {
    const r = validateReportConfig({
      date_range: { type: 'last_n_days', days: 7 },
      blocks: [
        {
          id: 'same',
          size: 'sm',
          block: { type: 'kpi', metric: met('count') },
        },
        {
          id: 'same',
          size: 'sm',
          block: { type: 'kpi', metric: met('count') },
        },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors?.some((e) => /duplicate/.test(e))).toBe(true);
  });

  it('rejects between-filter without array value', () => {
    const r = validateReportConfig({
      date_range: { type: 'last_n_days', days: 7 },
      blocks: [
        {
          id: 'b1',
          size: 'md',
          block: {
            type: 'kpi',
            metric: met('count'),
            filters: [
              { field: 'created_at', operator: 'between', value: 'not-array' },
            ],
          },
        },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors?.some((e) => /between vereist een array/.test(e))).toBe(true);
  });

  it('rejects custom date_range with invalid dates', () => {
    const r = validateReportConfig({
      date_range: { type: 'custom', from: 'banaan', to: 'peer' },
      blocks: [
        {
          id: 'b1',
          size: 'sm',
          block: { type: 'kpi', metric: met('count') },
        },
      ],
    });
    expect(r.valid).toBe(false);
  });

  it('accepts table-block with rows + cols', () => {
    const cfg: ReportConfig = {
      date_range: { type: 'last_n_days', days: 30 },
      blocks: [
        {
          id: 't1',
          size: 'lg',
          block: {
            type: 'table',
            rows: [dim('recruiter')],
            cols: [dim('source')],
            metric: met('hire_count'),
          },
        },
      ],
    };
    expect(validateReportConfig(cfg).valid).toBe(true);
  });

  it('rejects bar-block without series', () => {
    const r = validateReportConfig({
      date_range: { type: 'last_n_days', days: 7 },
      blocks: [
        {
          id: 'b1',
          size: 'md',
          block: { type: 'bar', x: dim('source'), series: [] },
        },
      ],
    });
    expect(r.valid).toBe(false);
  });
});

describe('configSchema.resolveDateRange', () => {
  it('resolves last_n_days correctly', () => {
    const now = new Date('2025-04-15T10:00:00Z');
    const r = resolveDateRange({ type: 'last_n_days', days: 7 }, now);
    expect(r.from.getTime()).toBeLessThan(r.to.getTime());
    const days = (r.to.getTime() - r.from.getTime()) / 86400000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8);
  });

  it('resolves this_year to Jan 1 → now', () => {
    const now = new Date('2025-06-15T10:00:00Z');
    const r = resolveDateRange({ type: 'this_year' }, now);
    expect(r.from.getMonth()).toBe(0);
    expect(r.from.getDate()).toBe(1);
  });

  it('resolves custom range', () => {
    const r = resolveDateRange({
      type: 'custom',
      from: '2025-01-01',
      to: '2025-03-31',
    });
    expect(r.from.toISOString()).toMatch(/^2025-01-01/);
    expect(r.to.toISOString()).toMatch(/^2025-03-31/);
  });

  it('resolves last_quarter for Q2 → Q1 of same year', () => {
    const now = new Date('2025-05-15T00:00:00Z'); // Q2
    const r = resolveDateRange({ type: 'last_quarter' }, now);
    expect(r.from.getMonth()).toBe(0); // Jan
    expect(r.to.getMonth()).toBe(2); // Mar
  });
});

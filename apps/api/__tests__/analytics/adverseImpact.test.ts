/**
 * AI & Bias analytics tests — Sprint Q4.6.
 *
 * Test:
 *   - computeAdverseImpact (pure):
 *       * referentiegroep = hoogste selection-rate met ≥ 30 records,
 *         exclusief 'unknown'
 *       * 4/5-grens: precies 0.8 passeert, eronder faalt
 *       * < 30 → insufficient_data, geen ratio (suppressie)
 *       * geen enkele groep ≥ 30 → geen referentie, alle ratio's null
 *       * total = 0 → selection_rate 0, geen deling-door-nul
 *   - getAdverseImpact (service, gemockte DB): bucketing + suppressie e2e
 *   - getAiUsageTrend: aggregatie per maand + feature-sortering op volume
 *   - getMatchScoreDistribution: stabiele 10-bucket histogram + gemiddelde
 *   - getAiRetentionStatus: ≥ 6 mnd-check, WORM-garantie, lege tenant
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

import {
  ADVERSE_IMPACT_MIN_GROUP_SIZE,
  computeAdverseImpact,
  FOUR_FIFTHS_THRESHOLD,
  getAdverseImpact,
  getAiUsageTrend,
  getMatchScoreDistribution,
} from '../../src/modules/analytics/analytics.service';
import {
  AI_EVENTS_MIN_RETENTION_MONTHS,
  getAiRetentionStatus,
} from '../../src/modules/compliance/aiOversight.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

// ─── computeAdverseImpact (pure) ─────────────────────────────────────────────

describe('computeAdverseImpact', () => {
  it('kiest de groep met de hoogste selection-rate (≥ 30) als referentie', () => {
    const result = computeAdverseImpact([
      { group: 'male', total: 100, selected: 50 }, // rate 0.5 → referentie
      { group: 'female', total: 100, selected: 45 }, // rate 0.45
    ]);

    const male = result.find((r) => r.group === 'male')!;
    const female = result.find((r) => r.group === 'female')!;

    expect(male.is_reference).toBe(true);
    expect(male.impact_ratio).toBe(1);
    expect(male.passes_four_fifths).toBe(true);

    expect(female.is_reference).toBe(false);
    expect(female.impact_ratio).toBeCloseTo(0.9, 4);
    expect(female.passes_four_fifths).toBe(true);
  });

  it('4/5-grens: precies 0.8 passeert, eronder faalt', () => {
    const result = computeAdverseImpact([
      { group: 'a', total: 100, selected: 50 }, // referentie, rate 0.5
      { group: 'b', total: 100, selected: 40 }, // ratio exact 0.8
      { group: 'c', total: 100, selected: 39 }, // ratio 0.78
    ]);

    expect(result.find((r) => r.group === 'b')!.passes_four_fifths).toBe(true);
    expect(result.find((r) => r.group === 'b')!.impact_ratio).toBe(
      FOUR_FIFTHS_THRESHOLD
    );
    expect(result.find((r) => r.group === 'c')!.passes_four_fifths).toBe(false);
  });

  it('onderdrukt groepen kleiner dan 30 (onvoldoende data)', () => {
    const result = computeAdverseImpact([
      { group: 'male', total: 100, selected: 50 },
      { group: 'other', total: 29, selected: 29 }, // rate 1.0 maar te klein
    ]);

    const small = result.find((r) => r.group === 'other')!;
    expect(ADVERSE_IMPACT_MIN_GROUP_SIZE).toBe(30);
    expect(small.insufficient_data).toBe(true);
    expect(small.impact_ratio).toBeNull();
    expect(small.passes_four_fifths).toBeNull();
    // En de kleine groep mag ondanks rate 1.0 GEEN referentie zijn:
    expect(small.is_reference).toBe(false);
    expect(result.find((r) => r.group === 'male')!.is_reference).toBe(true);
  });

  it("'unknown' kan nooit referentie zijn, ook niet met de hoogste rate", () => {
    const result = computeAdverseImpact([
      { group: 'unknown', total: 200, selected: 200 }, // rate 1.0
      { group: 'female', total: 100, selected: 30 }, // rate 0.3 → referentie
    ]);

    expect(result.find((r) => r.group === 'unknown')!.is_reference).toBe(false);
    expect(result.find((r) => r.group === 'female')!.is_reference).toBe(true);
    // unknown heeft wél voldoende data → ratio t.o.v. female:
    expect(result.find((r) => r.group === 'unknown')!.impact_ratio).toBeCloseTo(
      1 / 0.3,
      2
    );
  });

  it('zonder enige groep ≥ 30 is er geen referentie en geen ratio', () => {
    const result = computeAdverseImpact([
      { group: 'male', total: 10, selected: 5 },
      { group: 'female', total: 12, selected: 3 },
    ]);

    for (const r of result) {
      expect(r.insufficient_data).toBe(true);
      expect(r.impact_ratio).toBeNull();
      expect(r.passes_four_fifths).toBeNull();
      expect(r.is_reference).toBe(false);
    }
  });

  it('total = 0 → selection_rate 0 zonder NaN', () => {
    const result = computeAdverseImpact([
      { group: 'male', total: 0, selected: 0 },
      { group: 'female', total: 50, selected: 10 },
    ]);
    const zero = result.find((r) => r.group === 'male')!;
    expect(zero.selection_rate).toBe(0);
    expect(Number.isNaN(zero.selection_rate)).toBe(false);
  });
});

// ─── Service-laag met gemockte DB ────────────────────────────────────────────

describe('getAdverseImpact (service)', () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it('bucket-t gender via normalizeGender en onderdrukt kleine groepen', async () => {
    // 40 mannen (10 hired), 35 vrouwen (2 hired), 5 zonder gender (unknown).
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => ({
        status: i < 10 ? 'hired' : 'active',
        gender: 'male',
        birthdate: null,
        nationalities: null,
      })),
      ...Array.from({ length: 35 }, (_, i) => ({
        status: i < 2 ? 'hired' : 'rejected',
        gender: 'female',
        birthdate: null,
        nationalities: null,
      })),
      ...Array.from({ length: 5 }, () => ({
        status: 'active',
        gender: null,
        birthdate: null,
        nationalities: null,
      })),
    ];

    const client = mockClient({ applications: rows });
    teardown = installPoolMock(client);

    const report = await getAdverseImpact(TENANT_ID);

    expect(report.total_applications).toBe(80);
    expect(report.min_group_size).toBe(30);
    expect(report.selected_definition).toBe('hired');

    const gender = report.dimensions.find((d) => d.dimension === 'gender')!;
    const male = gender.groups.find((g) => g.group === 'male')!;
    const female = gender.groups.find((g) => g.group === 'female')!;
    const unknown = gender.groups.find((g) => g.group === 'unknown')!;

    // male: 10/40 = 0.25 → referentie. female: 2/35 ≈ 0.0571 → ratio ≈ 0.2286.
    expect(male.is_reference).toBe(true);
    expect(female.impact_ratio).not.toBeNull();
    expect(female.passes_four_fifths).toBe(false);
    // unknown < 30 → onderdrukt:
    expect(unknown.insufficient_data).toBe(true);
    expect(unknown.impact_ratio).toBeNull();
  });
});

describe('getAiUsageTrend (service)', () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it('aggregeert per maand en sorteert features op totaal gebruik', async () => {
    const client = mockClient({
      ai_events: [
        { month: '2026-05', month_label: 'May 2026', feature: 'embedding', count: '10' },
        { month: '2026-05', month_label: 'May 2026', feature: 'match_explanation', count: '3' },
        { month: '2026-06', month_label: 'Jun 2026', feature: 'embedding', count: '20' },
      ],
    });
    teardown = installPoolMock(client);

    const trend = await getAiUsageTrend(TENANT_ID);

    expect(trend.months).toHaveLength(2);
    expect(trend.months[0].month).toBe('2026-05');
    expect(trend.months[0].total).toBe(13);
    expect(trend.months[0].by_feature).toEqual({
      embedding: 10,
      match_explanation: 3,
    });
    expect(trend.months[1].total).toBe(20);
    // embedding (30) vóór match_explanation (3):
    expect(trend.features).toEqual(['embedding', 'match_explanation']);
  });
});

describe('getMatchScoreDistribution (service)', () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it('returnt altijd 10 buckets (ook lege) + gemiddelde in %', async () => {
    const client = mockClient({
      __matcher: (sql: string) => {
        if (/AVG\(score\)/i.test(sql)) {
          return { rows: [{ total: '7', avg_score: '0.6510' }], rowCount: 1 };
        }
        if (/FROM match_scores/i.test(sql)) {
          return {
            rows: [
              { bucket_idx: 5, count: '4' },
              { bucket_idx: 9, count: '3' },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const dist = await getMatchScoreDistribution(TENANT_ID);

    expect(dist.buckets).toHaveLength(10);
    expect(dist.buckets[0]).toEqual({ bucket: '0-10', from_pct: 0, count: 0 });
    expect(dist.buckets[5]).toEqual({ bucket: '50-60', from_pct: 50, count: 4 });
    expect(dist.buckets[9]).toEqual({ bucket: '90-100', from_pct: 90, count: 3 });
    expect(dist.total).toBe(7);
    expect(dist.avg_score_pct).toBe(65.1);
  });
});

describe('getAiRetentionStatus (service)', () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it('rapporteert dekking, WORM-garantie en de 6-maanden-minimumeis', async () => {
    const eightMonthsAgo = new Date();
    eightMonthsAgo.setMonth(eightMonthsAgo.getMonth() - 8);

    const client = mockClient({
      ai_events: [
        {
          oldest: eightMonthsAgo.toISOString(),
          newest: new Date().toISOString(),
          total: '1234',
        },
      ],
    });
    teardown = installPoolMock(client);

    const status = await getAiRetentionStatus(TENANT_ID);

    expect(AI_EVENTS_MIN_RETENTION_MONTHS).toBe(6);
    expect(status.minimum_retention_months).toBe(6);
    expect(status.total_events).toBe(1234);
    expect(status.months_covered).toBeGreaterThanOrEqual(7);
    expect(status.worm_protected).toBe(true);
    expect(status.compliant).toBe(true);
  });

  it('lege tenant: 0 events, 0 maanden dekking, wel structureel compliant', async () => {
    const client = mockClient({
      ai_events: [{ oldest: null, newest: null, total: '0' }],
    });
    teardown = installPoolMock(client);

    const status = await getAiRetentionStatus(TENANT_ID);

    expect(status.total_events).toBe(0);
    expect(status.oldest_event_at).toBeNull();
    expect(status.months_covered).toBe(0);
    expect(status.compliant).toBe(true);
  });
});

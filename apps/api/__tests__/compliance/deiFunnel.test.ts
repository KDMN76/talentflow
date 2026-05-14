/**
 * DEI funnel service tests — Sprint Q3.6 (Agent III).
 *
 * Test:
 *   - bucketNationality (NL, EU-other, non-EU, unknown)
 *   - computeBiasIndicator (geen prev → 0, gelijke pct → 0, sterke shift → high)
 *   - computeDropOffPct edge cases
 *   - buildAlerts triggers (high severity, demographic skew, low signal)
 *   - generateDeiFunnel — happy path: aggregeert per stage + persist + audit
 *   - generateDeiFunnel — k-anonymity wordt afgedwongen op kleine groepen
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

import {
  bucketNationality,
  buildAlerts,
  computeBiasIndicator,
  computeDropOffPct,
  generateDeiFunnel,
  tallyToCounts,
  type DEIFunnelStage,
} from '../../src/modules/compliance/deiFunnel.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('bucketNationality', () => {
  it('returnt unknown bij empty/null', () => {
    expect(bucketNationality(null)).toBe('unknown');
    expect(bucketNationality([])).toBe('unknown');
    expect(bucketNationality([''])).toBe('unknown');
  });

  it('NL prioriteit', () => {
    expect(bucketNationality(['NL'])).toBe('NL');
    expect(bucketNationality(['DE', 'NL'])).toBe('NL'); // bipatride
  });

  it('EU-other voor andere EU-landen', () => {
    expect(bucketNationality(['DE'])).toBe('EU-other');
    expect(bucketNationality(['FR'])).toBe('EU-other');
  });

  it('non-EU voor landen buiten EU', () => {
    expect(bucketNationality(['US'])).toBe('non-EU');
    expect(bucketNationality(['GB'])).toBe('non-EU'); // UK is non-EU sinds Brexit
    expect(bucketNationality(['TR'])).toBe('non-EU');
  });
});

describe('computeBiasIndicator', () => {
  it('returnt 0 als prev null', () => {
    expect(computeBiasIndicator(null, { male: 5, female: 5 }, 0, 10)).toBe(0);
  });

  it('returnt 0 als totals 0', () => {
    expect(computeBiasIndicator({ male: 5 }, { male: 5 }, 0, 10)).toBe(0);
    expect(computeBiasIndicator({ male: 5 }, {}, 10, 0)).toBe(0);
  });

  it('returnt 0 wanneer pct exact gelijk', () => {
    // 60% / 40% in beide stages → bias 0
    const bias = computeBiasIndicator(
      { male: 60, female: 40 },
      { male: 30, female: 20 },
      100,
      50
    );
    expect(bias).toBe(0);
  });

  it('returnt hoge waarde bij sterke demographic shift', () => {
    // Stage 1: 60M/40F (60%/40%), Stage 2: 80M/20F (80%/20%)
    // female: prev 40%, curr 20% → deviation (40-20)/40 = 0.5 → 50%
    const bias = computeBiasIndicator(
      { male: 60, female: 40 },
      { male: 80, female: 20 },
      100,
      100
    );
    expect(bias).toBeGreaterThan(40);
    expect(bias).toBeLessThanOrEqual(100);
  });

  it('clamp op 100', () => {
    // Extreem geval — totale verdwijning van een groep
    const bias = computeBiasIndicator(
      { male: 50, female: 50 },
      { male: 100 },
      100,
      100
    );
    expect(bias).toBeLessThanOrEqual(100);
  });
});

describe('computeDropOffPct', () => {
  it('returnt 0 bij null prev of 0 prev', () => {
    expect(computeDropOffPct(null, 5)).toBe(0);
    expect(computeDropOffPct(0, 5)).toBe(0);
  });

  it('returnt 0 als curr >= prev (groei is geen drop-off)', () => {
    expect(computeDropOffPct(10, 12)).toBe(0);
    expect(computeDropOffPct(10, 10)).toBe(0);
  });

  it('berekent percentuele drop-off', () => {
    expect(computeDropOffPct(100, 70)).toBe(30);
    expect(computeDropOffPct(50, 25)).toBe(50);
  });
});

describe('buildAlerts', () => {
  function stage(overrides: Partial<DEIFunnelStage>): DEIFunnelStage {
    return {
      stage_name: 'Test',
      stage_position: 0,
      total: 100,
      by_gender: { male: 50, female: 50 },
      by_age_bracket: {},
      by_nationality_bucket: {},
      drop_off_from_previous_pct: 0,
      bias_indicator: 0,
      ...overrides,
    };
  }

  it('high severity bij bias > 25 EN drop-off > 30', () => {
    const alerts = buildAlerts([
      stage({
        stage_name: 'Interview',
        bias_indicator: 30,
        drop_off_from_previous_pct: 35,
      }),
    ]);
    expect(alerts.find((a) => a.type === 'bias_drop_off')?.severity).toBe('high');
  });

  it('low severity bij bias > 15 zonder hoge drop-off', () => {
    const alerts = buildAlerts([
      stage({
        stage_name: 'Screening',
        bias_indicator: 20,
        drop_off_from_previous_pct: 10,
      }),
    ]);
    expect(alerts.find((a) => a.type === 'bias_signal')?.severity).toBe('low');
  });

  it('medium severity demographic_skew bij groep > 70%', () => {
    const alerts = buildAlerts([
      stage({
        stage_name: 'Final',
        total: 100,
        by_gender: { male: 80, female: 20 },
      }),
    ]);
    expect(alerts.find((a) => a.type === 'demographic_skew')?.severity).toBe(
      'medium'
    );
  });

  it('geen alerts bij gezonde funnel', () => {
    expect(
      buildAlerts([
        stage({ bias_indicator: 5, drop_off_from_previous_pct: 8 }),
      ])
    ).toHaveLength(0);
  });
});

describe('tallyToCounts', () => {
  it('mapt Map<string,T[]> naar Record<string,number>', () => {
    const m = new Map<string, number[]>([
      ['male', [1, 1, 1]],
      ['female', [1]],
    ]);
    expect(tallyToCounts(m)).toEqual({ male: 3, female: 1 });
  });
});

describe('generateDeiFunnel', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('aggregeert per stage + dwingt k-anonymity af + schrijft snapshots + audit', async () => {
    // 3 stages: Applied (20), Interview (12), Offer (4)
    const apps: Array<Record<string, unknown>> = [];

    // Applied — 10 male, 10 female
    for (let i = 0; i < 10; i++) {
      apps.push({
        application_id: `a-app-m${i}`,
        candidate_id: `cm${i}`,
        stage_id: 's1',
        stage_name: 'Applied',
        stage_position: 1,
        gender: 'male',
        birthdate: '1990-01-01',
        nationalities: ['NL'],
      });
      apps.push({
        application_id: `a-app-f${i}`,
        candidate_id: `cf${i}`,
        stage_id: 's1',
        stage_name: 'Applied',
        stage_position: 1,
        gender: 'female',
        birthdate: '1985-01-01',
        nationalities: ['DE'],
      });
    }
    // Interview — 8 male, 4 female (drop-off vrouwen)
    for (let i = 0; i < 8; i++) {
      apps.push({
        application_id: `a-int-m${i}`,
        candidate_id: `cmi${i}`,
        stage_id: 's2',
        stage_name: 'Interview',
        stage_position: 2,
        gender: 'male',
        birthdate: '1990-01-01',
        nationalities: ['NL'],
      });
    }
    for (let i = 0; i < 4; i++) {
      apps.push({
        application_id: `a-int-f${i}`,
        candidate_id: `cfi${i}`,
        stage_id: 's2',
        stage_name: 'Interview',
        stage_position: 2,
        gender: 'female',
        birthdate: '1990-01-01',
        nationalities: ['NL'],
      });
    }

    const insertCalls: string[] = [];
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM applications/i.test(sql) && /JOIN candidates/i.test(sql)) {
          return { rows: apps, rowCount: apps.length };
        }
        if (/INSERT INTO dei_funnel_snapshots/i.test(sql)) {
          insertCalls.push('snapshot');
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          insertCalls.push('audit');
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const report = await generateDeiFunnel(
      TENANT_ID,
      {
        from: new Date('2026-01-01'),
        to: new Date('2026-03-31'),
      },
      USER_ID
    );

    expect(report.stages).toHaveLength(2);

    const applied = report.stages[0];
    expect(applied.stage_name).toBe('Applied');
    expect(applied.total).toBe(20);
    expect(applied.by_gender.male).toBe(10);
    expect(applied.by_gender.female).toBe(10);

    const interview = report.stages[1];
    expect(interview.stage_name).toBe('Interview');
    expect(interview.total).toBe(12);
    expect(interview.drop_off_from_previous_pct).toBeGreaterThan(0);
    // Vrouwen droppen disproportioneel (40% → 33%)
    expect(interview.bias_indicator).toBeGreaterThan(0);

    expect(insertCalls.filter((c) => c === 'snapshot').length).toBe(2); // 1 per stage
    expect(insertCalls).toContain('audit');
    expect(report.ai_disclosure).toMatch(/AI Act/i);
  });

  it('throws bij ongeldige periode', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      generateDeiFunnel(
        TENANT_ID,
        { from: new Date('2026-04-01'), to: new Date('2026-01-01') },
        USER_ID
      )
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
  });

  it('rapport bevat geen stages bij lege data', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM applications/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const report = await generateDeiFunnel(
      TENANT_ID,
      { from: new Date('2026-01-01'), to: new Date('2026-03-31') },
      USER_ID
    );
    expect(report.stages).toHaveLength(0);
    expect(report.alerts).toHaveLength(0);
  });

  it('k-anonymity verbergt kleine groepen — 4 male/3 female/3 other → enige groep met >=5 verschijnt', async () => {
    const apps: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 4; i++) {
      apps.push({
        application_id: `m${i}`,
        candidate_id: `cm${i}`,
        stage_id: 's1',
        stage_name: 'Applied',
        stage_position: 1,
        gender: 'male',
        birthdate: '1990-01-01',
        nationalities: ['NL'],
      });
    }
    for (let i = 0; i < 3; i++) {
      apps.push({
        application_id: `f${i}`,
        candidate_id: `cf${i}`,
        stage_id: 's1',
        stage_name: 'Applied',
        stage_position: 1,
        gender: 'female',
        birthdate: '1990-01-01',
        nationalities: ['NL'],
      });
    }
    for (let i = 0; i < 3; i++) {
      apps.push({
        application_id: `o${i}`,
        candidate_id: `co${i}`,
        stage_id: 's1',
        stage_name: 'Applied',
        stage_position: 1,
        gender: 'other',
        birthdate: '1990-01-01',
        nationalities: ['NL'],
      });
    }
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM applications/i.test(sql) && /JOIN candidates/i.test(sql)) {
          return { rows: apps, rowCount: apps.length };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const report = await generateDeiFunnel(
      TENANT_ID,
      { from: new Date('2026-01-01'), to: new Date('2026-03-31') },
      USER_ID
    );

    const applied = report.stages[0];
    // Geen enkele groep haalt threshold (4, 3, 3) — wel de overflow van
    // 4+3+3 = 10 → 'other' wordt aangemaakt met 10 entries.
    expect(applied.by_gender.male).toBeUndefined();
    expect(applied.by_gender.female).toBeUndefined();
    // 'other' is nu de gemerged-bucket (4+3+3 = 10 entries; 'other' bucket
    // was 3 < threshold dus mergedt met overflow → 10 in 'other').
    expect(applied.by_gender.other).toBe(10);
  });
});

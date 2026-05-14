/**
 * Pay-equity service tests — Sprint Q3.6 (Agent III).
 *
 * Test:
 *   - K-anonymity merge — kleine groepen worden naar 'other' verplaatst
 *   - K-anonymity drop — overflow < threshold wordt weggelaten
 *   - bucketAge / computeAge edge cases (geen birthdate, leeftijd 0/120+)
 *   - normalizeGender mapt unknown waardes naar 'unknown'
 *   - computeMidpoint NULL-handling
 *   - computePayGap formule
 *   - generatePayEquityReport — happy path: aggregeert + audit + snapshot insert
 *   - generatePayEquityReport — k-anonymity wordt afgedwongen
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

import {
  K_ANONYMITY_THRESHOLD,
  applyKAnonymity,
  bucketAge,
  computeAge,
  computeMidpoint,
  computePayGap,
  generatePayEquityReport,
  median,
  mean,
  normalizeGender,
} from '../../src/modules/compliance/payEquity.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('payEquity pure helpers', () => {
  it('computeMidpoint returnt NULL als beide null', () => {
    expect(computeMidpoint(null, null)).toBeNull();
  });

  it('computeMidpoint returnt enkele waarde als 1 null', () => {
    expect(computeMidpoint(50000, null)).toBe(50000);
    expect(computeMidpoint(null, 60000)).toBe(60000);
  });

  it('computeMidpoint berekent gemiddelde van min+max', () => {
    expect(computeMidpoint(40000, 60000)).toBe(50000);
  });

  it('computeAge handelt null-birthdate', () => {
    expect(computeAge(null, new Date('2026-01-01'))).toBeNull();
  });

  it('computeAge handelt onmogelijke datums', () => {
    expect(computeAge('not-a-date', new Date('2026-01-01'))).toBeNull();
  });

  it('computeAge berekent leeftijd correct (verjaardag al gepasseerd)', () => {
    expect(computeAge('1990-01-01', new Date('2026-06-15'))).toBe(36);
  });

  it('computeAge berekent leeftijd correct (verjaardag nog niet gepasseerd)', () => {
    expect(computeAge('1990-12-31', new Date('2026-06-15'))).toBe(35);
  });

  it('computeAge filtert onrealistische leeftijden', () => {
    expect(computeAge('1700-01-01', new Date('2026-01-01'))).toBeNull();
    expect(computeAge('2030-01-01', new Date('2026-01-01'))).toBeNull();
  });

  it('bucketAge mapt naar standaard brackets', () => {
    expect(bucketAge(null)).toBe('unknown');
    expect(bucketAge(20)).toBe('<25');
    expect(bucketAge(28)).toBe('25-34');
    expect(bucketAge(40)).toBe('35-44');
    expect(bucketAge(50)).toBe('45-54');
    expect(bucketAge(65)).toBe('55+');
  });

  it('normalizeGender mapt onbekende waardes naar unknown', () => {
    expect(normalizeGender(null)).toBe('unknown');
    expect(normalizeGender('')).toBe('unknown');
    expect(normalizeGender('xyz')).toBe('unknown');
    expect(normalizeGender('Male')).toBe('male');
    expect(normalizeGender('FEMALE')).toBe('female');
    expect(normalizeGender('prefer_not')).toBe('prefer_not');
  });

  it('median werkt voor oneven en even arrays', () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('mean werkt voor lege en gevulde arrays', () => {
    expect(mean([])).toBe(0);
    expect(mean([10, 20, 30])).toBe(20);
  });

  it('computePayGap returnt 0 voor < 2 groepen', () => {
    expect(computePayGap([])).toBe(0);
    expect(computePayGap([50000])).toBe(0);
  });

  it('computePayGap berekent (max-min)/max*100', () => {
    // 50000 vs 60000 → (60-50)/60 * 100 = 16.67%
    expect(computePayGap([50000, 60000])).toBeCloseTo(16.67, 2);
  });

  it('computePayGap returnt 0 als max <= 0', () => {
    expect(computePayGap([0, 0])).toBe(0);
  });
});

describe('applyKAnonymity', () => {
  it('groepen >= threshold blijven intact', () => {
    const raw = new Map<string, number[]>([
      ['male', new Array(10).fill(50000)],
      ['female', new Array(8).fill(48000)],
    ]);
    const safe = applyKAnonymity(raw);
    expect(safe.get('male')?.length).toBe(10);
    expect(safe.get('female')?.length).toBe(8);
  });

  it('kleine groepen worden naar other gemerged als gezamenlijk groot genoeg', () => {
    const raw = new Map<string, number[]>([
      ['male', new Array(10).fill(50000)],
      ['female', new Array(2).fill(45000)],
      ['other', new Array(3).fill(40000)], // 2+3=5 → > threshold? Nee 'other' alleen heeft 3.
    ]);
    const safe = applyKAnonymity(raw);
    expect(safe.get('male')?.length).toBe(10);
    // 'other' bestaat al — overflow (female 2) wordt erin gemergedt
    expect(safe.get('other')?.length).toBe(5); // 3 + 2 overflow
    expect(safe.has('female')).toBe(false);
  });

  it('overflow < threshold zonder bestaande other wordt weggelaten', () => {
    const raw = new Map<string, number[]>([
      ['male', new Array(10).fill(50000)],
      ['female', new Array(2).fill(45000)],
    ]);
    const safe = applyKAnonymity(raw);
    expect(safe.get('male')?.length).toBe(10);
    // overflow = 2 < threshold 5 → niet gepubliceerd
    expect(safe.has('other')).toBe(false);
    expect(safe.has('female')).toBe(false);
  });

  it('alleen overflow >= threshold creëert nieuwe other-groep', () => {
    const raw = new Map<string, number[]>([
      ['male', new Array(10).fill(50000)],
      ['female', new Array(3).fill(45000)],
      ['unknown', new Array(2).fill(42000)],
    ]);
    const safe = applyKAnonymity(raw);
    expect(safe.get('male')?.length).toBe(10);
    // 3+2 = 5 >= threshold → 'other' krijgt 5 entries
    expect(safe.get('other')?.length).toBe(5);
  });

  it('threshold parameter werkt — K=10 forceert grotere merges', () => {
    const raw = new Map<string, number[]>([
      ['male', new Array(10).fill(50000)],
      ['female', new Array(8).fill(48000)],
    ]);
    const safe = applyKAnonymity(raw, 10);
    expect(safe.get('male')?.length).toBe(10);
    // female 8 < 10, geen other → female wordt verzwegen
    expect(safe.has('female')).toBe(false);
  });
});

describe('generatePayEquityReport', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('aggregeert offers + dwingt k-anonymity af + schrijft snapshot + audit', async () => {
    // Bouw een dataset met:
    //   * 6 male, 6 female, 2 other → 'other' < K → samengevoegd of weggelaten
    const offers: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 6; i++) {
      offers.push({
        application_id: `m${i}`,
        candidate_id: `cm${i}`,
        gender: 'male',
        birthdate: '1990-06-15',
        salary_min: 40000,
        salary_max: 60000,
        job_industry: 'tech',
      });
    }
    for (let i = 0; i < 6; i++) {
      offers.push({
        application_id: `f${i}`,
        candidate_id: `cf${i}`,
        gender: 'female',
        birthdate: '1985-06-15',
        salary_min: 38000,
        salary_max: 56000,
        job_industry: 'tech',
      });
    }
    for (let i = 0; i < 2; i++) {
      offers.push({
        application_id: `o${i}`,
        candidate_id: `co${i}`,
        gender: 'other',
        birthdate: '1995-01-01',
        salary_min: 42000,
        salary_max: 58000,
        job_industry: 'tech',
      });
    }

    const insertCalls: string[] = [];
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM applications/i.test(sql) && /JOIN candidates/i.test(sql)) {
          return { rows: offers, rowCount: offers.length };
        }
        if (/INSERT INTO pay_equity_snapshots/i.test(sql)) {
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

    const report = await generatePayEquityReport(
      TENANT_ID,
      {
        from: new Date('2026-01-01T00:00:00Z'),
        to: new Date('2026-03-31T23:59:59Z'),
      },
      USER_ID
    );

    expect(report.total_offers).toBe(14);
    expect(report.median_salary).toBeGreaterThan(0);
    expect(report.by_gender.male).toBeDefined();
    expect(report.by_gender.female).toBeDefined();
    // 'other' had 2 entries < K=5 → niet als top-level groep gepubliceerd
    expect(report.by_gender.other).toBeUndefined();
    expect(report.pay_gap_pct).toBeGreaterThanOrEqual(0);
    expect(report.ai_disclosure).toMatch(/Pay Transparency Directive/i);
    expect(insertCalls).toContain('snapshot');
    expect(insertCalls).toContain('audit');
  });

  it('throws bij ongeldige periode (from > to)', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      generatePayEquityReport(
        TENANT_ID,
        {
          from: new Date('2026-04-01'),
          to: new Date('2026-01-01'),
        },
        USER_ID
      )
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
  });

  it('rapport is leeg bij geen offers — geen pay-gap', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM applications/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const report = await generatePayEquityReport(
      TENANT_ID,
      { from: new Date('2026-01-01'), to: new Date('2026-03-31') },
      USER_ID
    );
    expect(report.total_offers).toBe(0);
    expect(report.median_salary).toBe(0);
    expect(report.pay_gap_pct).toBe(0);
    expect(Object.keys(report.by_gender)).toHaveLength(0);
  });
});

describe('K_ANONYMITY_THRESHOLD constant', () => {
  it('staat op 5 — directive minimum', () => {
    expect(K_ANONYMITY_THRESHOLD).toBe(5);
  });
});

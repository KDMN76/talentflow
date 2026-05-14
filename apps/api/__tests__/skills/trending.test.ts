import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import {
  computeGrowthPct,
  computeScarcityRatio,
  getTrendingSkills,
  getSkillDemandSupply,
} from '../../src/modules/skills/trending.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('computeGrowthPct', () => {
  it('returns 0 when both periods are zero', () => {
    expect(computeGrowthPct(0, 0)).toBe(0);
  });
  it('returns +100 when prev is zero and current is positive', () => {
    expect(computeGrowthPct(0, 5)).toBe(100);
  });
  it('computes positive growth', () => {
    expect(computeGrowthPct(10, 15)).toBe(50);
  });
  it('computes negative growth', () => {
    expect(computeGrowthPct(20, 10)).toBe(-50);
  });
  it('rounds to 2 decimals', () => {
    expect(computeGrowthPct(3, 4)).toBeCloseTo(33.33, 2);
  });
  it('handles -100% correctly', () => {
    expect(computeGrowthPct(5, 0)).toBe(-100);
  });
});

describe('computeScarcityRatio', () => {
  it('demand=0, supply=0 → 0', () => {
    expect(computeScarcityRatio(0, 0)).toBe(0);
  });
  it('demand=10, supply=2 → 5.0 (tekort)', () => {
    expect(computeScarcityRatio(10, 2)).toBe(5);
  });
  it('demand=2, supply=10 → 0.2 (overschot)', () => {
    expect(computeScarcityRatio(2, 10)).toBe(0.2);
  });
  it('treats supply=0 as 1 to avoid /0', () => {
    expect(computeScarcityRatio(7, 0)).toBe(7);
  });
});

describe('getTrendingSkills', () => {
  let client: MockClient;
  let teardown: () => void;
  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('sorts results by growth_pct desc and computes growth correctly', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/skills_trending_snapshots/i.test(sql)) {
          return {
            rows: [
              {
                esco_skill_id: 'KS001',
                preferred_label: 'JavaScript',
                category: 'IT',
                candidate_count: 50,
                job_demand: 20,
                hire_count: 2,
                prev_job_demand: 10,
              },
              {
                esco_skill_id: 'KS002',
                preferred_label: 'TypeScript',
                category: 'IT',
                candidate_count: 30,
                job_demand: 60,
                hire_count: 3,
                prev_job_demand: 20,
              },
              {
                esco_skill_id: 'KS003',
                preferred_label: 'PHP',
                category: 'IT',
                candidate_count: 25,
                job_demand: 5,
                hire_count: 0,
                prev_job_demand: 10,
              },
            ],
            rowCount: 3,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const out = await getTrendingSkills(TENANT);
    expect(out).toHaveLength(3);
    // TypeScript: 20→60 = +200%, JavaScript: 10→20 = +100%, PHP: 10→5 = -50%
    expect(out[0].esco_skill_id).toBe('KS002');
    expect(out[0].growth_pct).toBe(200);
    expect(out[1].esco_skill_id).toBe('KS001');
    expect(out[1].growth_pct).toBe(100);
    expect(out[2].esco_skill_id).toBe('KS003');
    expect(out[2].growth_pct).toBe(-50);
  });

  it('treats missing prev_job_demand as zero baseline', async () => {
    client = mockClient({
      __matcher: () => ({
        rows: [
          {
            esco_skill_id: 'KS010',
            preferred_label: 'New Skill',
            category: 'IT',
            candidate_count: 5,
            job_demand: 8,
            hire_count: 0,
            prev_job_demand: null,
          },
        ],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);
    const out = await getTrendingSkills(TENANT);
    expect(out[0].growth_pct).toBe(100);
    expect(out[0].scarcity_ratio).toBe(1.6);
  });

  it('returns empty array when no snapshots exist', async () => {
    client = mockClient({ __matcher: () => ({ rows: [], rowCount: 0 }) });
    teardown = installPoolMock(client);
    expect(await getTrendingSkills(TENANT)).toEqual([]);
  });
});

describe('getSkillDemandSupply', () => {
  let client: MockClient;
  let teardown: () => void;
  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('aggregates demand/supply per category and returns gap', async () => {
    client = mockClient({
      __matcher: () => ({
        rows: [
          { category: 'IT', demand: 12, supply: 30 },
          { category: 'Design', demand: 5, supply: 2 },
          { category: 'Sales', demand: 0, supply: 8 },
        ],
        rowCount: 3,
      }),
    });
    teardown = installPoolMock(client);
    const out = await getSkillDemandSupply(TENANT);
    expect(out.per_category).toHaveLength(3);
    expect(out.per_category[0]).toEqual({
      category: 'IT',
      demand: 12,
      supply: 30,
      gap: -18,
    });
    expect(out.per_category[1]).toEqual({
      category: 'Design',
      demand: 5,
      supply: 2,
      gap: 3,
    });
    expect(out.per_category[2]).toEqual({
      category: 'Sales',
      demand: 0,
      supply: 8,
      gap: -8,
    });
  });

  it('null category falls back to "Other"', async () => {
    client = mockClient({
      __matcher: () => ({
        rows: [{ category: null, demand: 4, supply: 1 }],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);
    const out = await getSkillDemandSupply(TENANT);
    expect(out.per_category[0].category).toBe('Other');
  });
});

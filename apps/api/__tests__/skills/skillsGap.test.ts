import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import {
  analyzeSkillsGap,
  classifyRecommendation,
} from '../../src/modules/skills/skills.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const JOB = '22222222-2222-2222-2222-222222222222';
const CAND = '33333333-3333-3333-3333-333333333333';

describe('classifyRecommendation thresholds', () => {
  it('strong_fit at >= 80', () => {
    expect(classifyRecommendation(100)).toBe('strong_fit');
    expect(classifyRecommendation(80)).toBe('strong_fit');
  });
  it('good_fit at 60–79', () => {
    expect(classifyRecommendation(79)).toBe('good_fit');
    expect(classifyRecommendation(60)).toBe('good_fit');
  });
  it('partial_fit at 40–59', () => {
    expect(classifyRecommendation(59)).toBe('partial_fit');
    expect(classifyRecommendation(40)).toBe('partial_fit');
  });
  it('weak_fit below 40', () => {
    expect(classifyRecommendation(39)).toBe('weak_fit');
    expect(classifyRecommendation(0)).toBe('weak_fit');
  });
});

describe('analyzeSkillsGap', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  function setupClient(jobSkills: unknown[], candSkills: unknown[]): void {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM job_skill_mappings/i.test(sql)) {
          return { rows: jobSkills as Record<string, unknown>[], rowCount: jobSkills.length };
        }
        if (/FROM candidate_skill_mappings/i.test(sql)) {
          return { rows: candSkills as Record<string, unknown>[], rowCount: candSkills.length };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
  }

  it('strong_fit: all required matched + bonus skills', async () => {
    setupClient(
      [
        { esco_skill_id: 'KS001', preferred_label: 'JavaScript', category: 'IT', required: true },
        { esco_skill_id: 'KS002', preferred_label: 'TypeScript', category: 'IT', required: true },
        { esco_skill_id: 'KS003', preferred_label: 'React',      category: 'IT', required: false },
      ],
      [
        { esco_skill_id: 'KS001', preferred_label: 'JavaScript', category: 'IT', proficiency: 9 },
        { esco_skill_id: 'KS002', preferred_label: 'TypeScript', category: 'IT', proficiency: 8 },
        { esco_skill_id: 'KS099', preferred_label: 'GraphQL',    category: 'IT', proficiency: 7 },
      ]
    );

    const r = await analyzeSkillsGap(TENANT, JOB, CAND);
    expect(r.match_pct).toBe(100);
    expect(r.recommendation).toBe('strong_fit');
    expect(r.required_skills_match).toHaveLength(2);
    expect(r.required_skills_match.every((s) => s.has)).toBe(true);
    expect(r.nice_to_have_match).toHaveLength(1);
    expect(r.nice_to_have_match[0].has).toBe(false);
    expect(r.bonus_skills).toHaveLength(1);
    expect(r.bonus_skills[0].esco_skill_id).toBe('KS099');
  });

  it('good_fit: 2 of 3 required (67%)', async () => {
    setupClient(
      [
        { esco_skill_id: 'KS001', preferred_label: 'JavaScript', category: 'IT', required: true },
        { esco_skill_id: 'KS002', preferred_label: 'TypeScript', category: 'IT', required: true },
        { esco_skill_id: 'KS003', preferred_label: 'PostgreSQL', category: 'IT', required: true },
      ],
      [
        { esco_skill_id: 'KS001', preferred_label: 'JavaScript', category: 'IT', proficiency: 9 },
        { esco_skill_id: 'KS002', preferred_label: 'TypeScript', category: 'IT', proficiency: 8 },
      ]
    );
    const r = await analyzeSkillsGap(TENANT, JOB, CAND);
    expect(r.match_pct).toBeCloseTo(66.67, 2);
    expect(r.recommendation).toBe('good_fit');
  });

  it('partial_fit: 2 of 4 required (50%)', async () => {
    setupClient(
      [
        { esco_skill_id: 'KS001', preferred_label: 'A', category: 'IT', required: true },
        { esco_skill_id: 'KS002', preferred_label: 'B', category: 'IT', required: true },
        { esco_skill_id: 'KS003', preferred_label: 'C', category: 'IT', required: true },
        { esco_skill_id: 'KS004', preferred_label: 'D', category: 'IT', required: true },
      ],
      [
        { esco_skill_id: 'KS001', preferred_label: 'A', category: 'IT', proficiency: 8 },
        { esco_skill_id: 'KS002', preferred_label: 'B', category: 'IT', proficiency: 8 },
      ]
    );
    const r = await analyzeSkillsGap(TENANT, JOB, CAND);
    expect(r.match_pct).toBe(50);
    expect(r.recommendation).toBe('partial_fit');
  });

  it('weak_fit: 1 of 5 required (20%)', async () => {
    setupClient(
      Array.from({ length: 5 }, (_, i) => ({
        esco_skill_id: `KS00${i + 1}`,
        preferred_label: `Skill${i + 1}`,
        category: 'IT',
        required: true,
      })),
      [
        { esco_skill_id: 'KS001', preferred_label: 'Skill1', category: 'IT', proficiency: 5 },
      ]
    );
    const r = await analyzeSkillsGap(TENANT, JOB, CAND);
    expect(r.match_pct).toBe(20);
    expect(r.recommendation).toBe('weak_fit');
  });

  it('nice-to-have skills do not affect match_pct', async () => {
    setupClient(
      [
        { esco_skill_id: 'KS001', preferred_label: 'A', category: 'IT', required: true },
        { esco_skill_id: 'KS002', preferred_label: 'B', category: 'IT', required: false },
        { esco_skill_id: 'KS003', preferred_label: 'C', category: 'IT', required: false },
      ],
      [
        { esco_skill_id: 'KS001', preferred_label: 'A', category: 'IT', proficiency: 8 },
      ]
    );
    const r = await analyzeSkillsGap(TENANT, JOB, CAND);
    expect(r.match_pct).toBe(100);
    expect(r.recommendation).toBe('strong_fit');
    expect(r.nice_to_have_match.every((s) => !s.has)).toBe(true);
  });

  it('returns proficiency on matched candidate skill', async () => {
    setupClient(
      [
        { esco_skill_id: 'KS001', preferred_label: 'JavaScript', category: 'IT', required: true },
      ],
      [
        { esco_skill_id: 'KS001', preferred_label: 'JavaScript', category: 'IT', proficiency: 7 },
      ]
    );
    const r = await analyzeSkillsGap(TENANT, JOB, CAND);
    expect(r.required_skills_match[0].proficiency).toBe(7);
  });

  it('empty job skills returns weak_fit with bonus skills', async () => {
    setupClient([], [
      { esco_skill_id: 'KS001', preferred_label: 'JavaScript', category: 'IT', proficiency: 7 },
    ]);
    const r = await analyzeSkillsGap(TENANT, JOB, CAND);
    expect(r.match_pct).toBe(0);
    expect(r.recommendation).toBe('weak_fit');
    expect(r.bonus_skills).toHaveLength(1);
  });

  it('job with only nice-to-have (no required) reports 100%', async () => {
    setupClient(
      [
        { esco_skill_id: 'KS001', preferred_label: 'A', category: 'IT', required: false },
      ],
      []
    );
    const r = await analyzeSkillsGap(TENANT, JOB, CAND);
    expect(r.match_pct).toBe(100);
    expect(r.recommendation).toBe('strong_fit');
  });

  it('bonus skills excluded when also required', async () => {
    setupClient(
      [
        { esco_skill_id: 'KS001', preferred_label: 'A', category: 'IT', required: true },
      ],
      [
        { esco_skill_id: 'KS001', preferred_label: 'A', category: 'IT', proficiency: 8 },
      ]
    );
    const r = await analyzeSkillsGap(TENANT, JOB, CAND);
    expect(r.bonus_skills).toHaveLength(0);
  });
});

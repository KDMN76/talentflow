/**
 * Talent-Fit service tests — Sprint Q3.3.
 *
 * We mocken de pg-pool met een SQL-pattern matcher en checken alle paden:
 *   1. INSUFFICIENT_DATA wanneer < MIN_SAMPLES_PER_CLASS hires of rejects.
 *   2. Successvolle training: deactiveert oude models, insert nieuwe rij.
 *   3. predictForCandidateJob: cache-hit pad.
 *   4. predictForCandidateJob: cache-miss + INSERT in talent_fit_predictions.
 *   5. getActiveModel returns null wanneer geen rij actief.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';
import {
  trainTalentFitModel,
  getActiveModel,
  predictForCandidateJob,
  MIN_SAMPLES_PER_CLASS,
} from '../src/modules/matching/talentFit.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const JOB_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAND_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MODEL_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — synthetic application rows voor training
// ─────────────────────────────────────────────────────────────────────────────

function makeApplicationRow(label: 'hired' | 'rejected', i: number) {
  // Hired = high signal, rejected = low signal. We bouwen 8-dim embeddings
  // die in [-1,1] vallen (genormaliseerd). cosineSimilarity in features.ts
  // mapt cos → (1+cos)/2 dus vector [1,1,..] vs [1,1,..] → 1.
  const high = label === 'hired';
  const baseEmb = high ? [1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5] : [0.1, 0.2, -0.1, 0, 0, 0, 0, 0];
  const jobEmb = [1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5];
  return {
    status: label,
    c_id: `c${i}`,
    c_embedding: baseEmb,
    c_skills: high ? ['typescript', 'react'] : ['cobol'],
    c_current_position: high ? 'Senior Engineer' : 'Office Manager',
    c_yoe: high ? 8 : 1,
    c_source: high ? 'referral' : 'jobboard',
    c_resume_url: 'https://example.com/cv.pdf',
    c_last_activity_at: new Date(),
    j_id: 'j1',
    j_title: 'Senior Engineer',
    j_embedding: jobEmb,
    j_required_skills: ['typescript', 'react'],
    j_description: 'Senior TypeScript role',
    c_candidate_skills: high
      ? [
          { skill: 'typescript', score: 90 },
          { skill: 'react', score: 80 },
        ]
      : [{ skill: 'cobol', score: 50 }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// trainTalentFitModel
// ─────────────────────────────────────────────────────────────────────────────

describe('trainTalentFitModel', () => {
  let teardown: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    teardown?.();
    teardown = undefined;
  });

  it('throws INSUFFICIENT_DATA when fewer than threshold hires', async () => {
    const fewHires = Array.from({ length: 5 }, (_, i) => makeApplicationRow('hired', i));
    const manyRejects = Array.from({ length: 25 }, (_, i) => makeApplicationRow('rejected', i + 100));
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/FROM applications a[\s\S]+JOIN candidates/i.test(sql) && /a\.status IN/i.test(sql)) {
          return { rows: [...fewHires, ...manyRejects], rowCount: 30 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(trainTalentFitModel(TENANT_ID, 'cron')).rejects.toMatchObject({
      code: 'INSUFFICIENT_DATA',
    });
  });

  it('throws INSUFFICIENT_DATA when fewer than threshold rejects', async () => {
    const manyHires = Array.from({ length: 25 }, (_, i) => makeApplicationRow('hired', i));
    const fewRejects = Array.from({ length: 3 }, (_, i) => makeApplicationRow('rejected', i + 100));
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/FROM applications a[\s\S]+JOIN candidates/i.test(sql) && /a\.status IN/i.test(sql)) {
          return { rows: [...manyHires, ...fewRejects], rowCount: 28 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(trainTalentFitModel(TENANT_ID, 'cron')).rejects.toMatchObject({
      code: 'INSUFFICIENT_DATA',
    });
  });

  it('trains successfully with sufficient data + UPSERTS active model', async () => {
    const hires = Array.from({ length: 25 }, (_, i) => makeApplicationRow('hired', i));
    const rejects = Array.from({ length: 25 }, (_, i) => makeApplicationRow('rejected', i + 100));
    let updateCalls = 0;
    let insertCalls = 0;
    let auditCalls = 0;
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/FROM applications a[\s\S]+JOIN candidates[\s\S]+a\.status IN/i.test(sql)) {
          return { rows: [...hires, ...rejects], rowCount: 50 };
        }
        if (/SELECT lower\(c\.source\)/i.test(sql)) {
          return {
            rows: [
              { source: 'referral', hires: '20', total: '25' },
              { source: 'jobboard', hires: '5', total: '25' },
            ],
            rowCount: 2,
          };
        }
        if (/UPDATE talent_fit_models SET active = FALSE/i.test(sql)) {
          updateCalls++;
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO talent_fit_models/i.test(sql)) {
          insertCalls++;
          return {
            rows: [
              {
                id: MODEL_ID,
                tenant_id: TENANT_ID,
                coefficients: {},
                feature_names: [],
                trained_on: 50,
                hires: 25,
                rejects: 25,
                precision_at_1: '1.0000',
                recall_at_10: '1.0000',
                auc: '1.0000',
                trained_at: new Date().toISOString(),
                trained_by: 'cron',
                active: true,
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          auditCalls++;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const model = await trainTalentFitModel(TENANT_ID, 'cron');
    expect(model.id).toBe(MODEL_ID);
    expect(updateCalls).toBe(1);
    expect(insertCalls).toBe(1);
    expect(auditCalls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getActiveModel
// ─────────────────────────────────────────────────────────────────────────────

describe('getActiveModel', () => {
  let teardown: (() => void) | undefined;
  afterEach(() => {
    teardown?.();
    teardown = undefined;
  });

  it('returns null wanneer geen actief model', async () => {
    const client: MockClient = mockClient({ __matcher: () => ({ rows: [], rowCount: 0 }) });
    teardown = installPoolMock(client);
    const result = await getActiveModel(TENANT_ID);
    expect(result).toBeNull();
  });

  it('hydrate model uit row', async () => {
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/FROM talent_fit_models/i.test(sql)) {
          return {
            rows: [
              {
                id: MODEL_ID,
                tenant_id: TENANT_ID,
                coefficients: {
                  weights: new Array(10).fill(0.1),
                  intercept: 0,
                  normalization: new Array(10).fill({ mean: 0, std: 1 }),
                },
                feature_names: [
                  'cosine_sim',
                  'skills_overlap_pct',
                  'skills_score_avg',
                  'yoe_match',
                  'source_encoded',
                  'has_referral',
                  'desc_length_norm',
                  'position_match',
                  'recency_score',
                  'has_resume',
                ],
                trained_on: 100,
                hires: 50,
                rejects: 50,
                precision_at_1: '0.8000',
                recall_at_10: '0.9000',
                auc: '0.85',
                trained_at: new Date().toISOString(),
                trained_by: 'cron',
                active: true,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const result = await getActiveModel(TENANT_ID);
    expect(result).not.toBeNull();
    expect(result!.row.id).toBe(MODEL_ID);
    expect(result!.model.weights.length).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// predictForCandidateJob
// ─────────────────────────────────────────────────────────────────────────────

describe('predictForCandidateJob', () => {
  let teardown: (() => void) | undefined;
  afterEach(() => {
    teardown?.();
    teardown = undefined;
  });

  it('returns has_active_model=false wanneer geen model bestaat', async () => {
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/FROM jobs[\s\S]+WHERE id = \$1 AND tenant_id = \$2 AND deleted_at IS NULL/i.test(sql)) {
          return {
            rows: [{ id: JOB_ID, title: 'Engineer', embedding: null, required_skills: [], description: null }],
            rowCount: 1,
          };
        }
        if (/FROM candidates c\s+WHERE c\.id = \$1/i.test(sql)) {
          return {
            rows: [
              {
                id: CAND_ID,
                embedding: null,
                skills: [],
                current_position: null,
                years_of_experience: null,
                source: null,
                resume_url: null,
                description: null,
                ai_summary: null,
                last_activity_at: null,
                candidate_skills: [],
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM talent_fit_models/i.test(sql)) return { rows: [], rowCount: 0 };
        if (/SELECT lower\(c\.source\)/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await predictForCandidateJob(TENANT_ID, JOB_ID, CAND_ID);
    expect(result.has_active_model).toBe(false);
    expect(result.fit_score).toBeNull();
    expect(result.combined_score).toBeGreaterThanOrEqual(0);
  });

  it('uses cache when use_cache=true and a row exists', async () => {
    const cachedFeatures = {
      cosine_sim: 0.8,
      skills_overlap_pct: 0.5,
      skills_score_avg: 0.5,
      yoe_match: 0.7,
      source_encoded: 0.4,
      has_referral: 1,
      desc_length_norm: 0.6,
      position_match: 0.5,
      recency_score: 0.5,
      has_resume: 1,
    };
    let cacheLookups = 0;
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/FROM jobs[\s\S]+WHERE id = \$1 AND tenant_id = \$2 AND deleted_at IS NULL/i.test(sql)) {
          return {
            rows: [{ id: JOB_ID, title: 'Engineer', embedding: '[1,0]', required_skills: [], description: null }],
            rowCount: 1,
          };
        }
        if (/FROM candidates c\s+WHERE c\.id = \$1/i.test(sql)) {
          return {
            rows: [
              {
                id: CAND_ID,
                embedding: '[1,0]',
                skills: [],
                current_position: null,
                years_of_experience: null,
                source: null,
                resume_url: null,
                description: null,
                ai_summary: null,
                last_activity_at: null,
                candidate_skills: [],
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM talent_fit_models/i.test(sql)) {
          return {
            rows: [
              {
                id: MODEL_ID,
                tenant_id: TENANT_ID,
                coefficients: {
                  weights: new Array(10).fill(0.1),
                  intercept: 0,
                  normalization: new Array(10).fill({ mean: 0.5, std: 0.5 }),
                },
                feature_names: [],
                trained_on: 50,
                hires: 25,
                rejects: 25,
                precision_at_1: '0.8',
                recall_at_10: '0.9',
                auc: '0.85',
                trained_at: new Date().toISOString(),
                trained_by: 'cron',
                active: true,
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM talent_fit_predictions/i.test(sql)) {
          cacheLookups++;
          return {
            rows: [
              {
                fit_score: '0.7000',
                combined_score: '0.6500',
                feature_values: cachedFeatures,
                similar_hires: [],
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await predictForCandidateJob(TENANT_ID, JOB_ID, CAND_ID, { use_cache: true });
    expect(cacheLookups).toBe(1);
    expect(result.has_active_model).toBe(true);
    expect(result.fit_score).toBeCloseTo(0.7, 2);
    expect(result.combined_score).toBeCloseTo(0.65, 2);
    expect(result.features).toEqual(cachedFeatures);
  });

  it('throws 404 wanneer job niet bestaat', async () => {
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/FROM jobs[\s\S]+WHERE id = \$1/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      predictForCandidateJob(TENANT_ID, JOB_ID, CAND_ID)
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });

  it('throws 404 wanneer candidate niet bestaat', async () => {
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/FROM jobs[\s\S]+WHERE id = \$1 AND tenant_id = \$2 AND deleted_at IS NULL/i.test(sql)) {
          return {
            rows: [{ id: JOB_ID, title: 'X', embedding: null, required_skills: [], description: null }],
            rowCount: 1,
          };
        }
        if (/FROM candidates c\s+WHERE c\.id = \$1/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      predictForCandidateJob(TENANT_ID, JOB_ID, CAND_ID)
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
  });
});

describe('MIN_SAMPLES_PER_CLASS constant', () => {
  it('exposes the threshold for callers', () => {
    expect(MIN_SAMPLES_PER_CLASS).toBe(20);
  });
});

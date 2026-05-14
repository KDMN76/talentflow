/**
 * matching.service tests — Slice 4 (cosine) + Sprint Q3.3 Talent-Fit (Agent ZZ).
 *
 * We mocken `./talentFit.service.predictForCandidateJob` zodat de
 * matching-service tests zonder de hele Q3.3-pipeline (features+trainer+DB)
 * kunnen draaien. Twee belangrijke scenario's:
 *
 *   1. Geen actief model — predictForCandidateJob retourneert
 *      has_active_model=false. Verwacht: cosine-volgorde behouden,
 *      `fit_score=null`, `combined_score=cosine`, geen audit-event.
 *   2. Wél actief model — predictForCandidateJob geeft fit_score per kandidaat.
 *      Verwacht: re-rank op combined_score DESC, `match_percent` reflecteert
 *      combined, similar_hire_count aanwezig.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';

// ──────────────────────────────────────────────────────────────────────────────
// talentFit.service mock — we shadowen de hele module zodat de matching service
// hem als black box ziet. De mock-implementatie wordt per test gezet via
// vi.mocked(...).mockImplementation() / mockResolvedValue().
// ──────────────────────────────────────────────────────────────────────────────

vi.mock('../src/modules/matching/talentFit.service', () => ({
  predictForCandidateJob: vi.fn(),
}));

// Importeer NA vi.mock zodat de matching.service de gemockte module pakt.
import {
  getJobMatches,
  getCandidateMatches,
} from '../src/modules/matching/matching.service';
import * as talentFitService from '../src/modules/matching/talentFit.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const JOB_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAND_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const mockedPredict = vi.mocked(talentFitService.predictForCandidateJob);

/** Default: geen actief model — geen Talent-Fit verrijking. */
function setNoActiveModel(): void {
  mockedPredict.mockImplementation(async () => ({
    fit_score: null,
    combined_score: 0,
    cosine_sim: 0,
    features: {} as never,
    similar_hires: [],
    has_active_model: false,
    model_id: null,
  }));
}

/** Per-candidate fit_score override (voor re-rank tests). */
function setActiveModelWithFits(
  fits: Record<string, { fit: number; similar?: string[] }>
): void {
  mockedPredict.mockImplementation(async (_tenant, _job, candidateId) => {
    const entry = fits[candidateId] ?? { fit: 0.5, similar: [] };
    return {
      fit_score: entry.fit,
      combined_score: 0, // matching.service rebuildt dit zelf
      cosine_sim: 0,
      features: {} as never,
      similar_hires: (entry.similar ?? []).map((id) => ({
        candidate_id: id,
        candidate_name: 'past-hire',
        job_title: null,
        hired_at: null,
        similarity: 0.9,
      })),
      has_active_model: true,
      model_id: 'model-xyz',
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// getJobMatches — top candidates for a given job
// ──────────────────────────────────────────────────────────────────────────────

describe('getJobMatches', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    setNoActiveModel();
  });

  afterEach(() => {
    teardown?.();
  });

  it('returns [] when the job has no embedding yet', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM jobs/i.test(sql)) {
          return {
            rows: [{ id: JOB_ID, has_embedding: false }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const matches = await getJobMatches(TENANT_ID, JOB_ID, 10);
    expect(matches).toEqual([]);
    expect(mockedPredict).not.toHaveBeenCalled();
  });

  it('throws 404 when the job does not exist', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      getJobMatches(TENANT_ID, JOB_ID, 10)
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });

  it('returns candidates with cosine clamped, fit_score=null, combined=cosine when no active model', async () => {
    const now = new Date('2026-05-01T10:00:00Z');
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM jobs/i.test(sql)) {
          return {
            rows: [{ id: JOB_ID, has_embedding: true }],
            rowCount: 1,
          };
        }
        if (/FROM jobs j[\s\S]+JOIN candidates/i.test(sql)) {
          return {
            rows: [
              {
                candidate_id: CAND_ID,
                candidate_name: 'Sofia Vermeer',
                candidate_email: 'sofia@example.com',
                candidate_position: 'Engineer',
                score: 0.87,
                ai_explanation: 'Strong match',
                explanation_at: now,
                computed_at: now,
              },
              {
                candidate_id: 'cand-2',
                candidate_name: 'Out of bounds',
                candidate_email: null,
                candidate_position: null,
                score: 1.0001,
                ai_explanation: null,
                explanation_at: null,
                computed_at: now,
              },
              {
                candidate_id: 'cand-3',
                candidate_name: 'Negative match',
                candidate_email: null,
                candidate_position: null,
                score: -0.05,
                ai_explanation: null,
                explanation_at: null,
                computed_at: now,
              },
            ],
            rowCount: 3,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const matches = await getJobMatches(TENANT_ID, JOB_ID, 10);
    expect(matches).toHaveLength(3);

    // Cosine-volgorde behouden (DB-volgorde — geen re-rank zonder model).
    expect(matches[0].candidate_name).toBe('Sofia Vermeer');
    expect(matches[0].cosine_score).toBeCloseTo(0.87, 4);
    expect(matches[0].fit_score).toBeNull();
    expect(matches[0].combined_score).toBeCloseTo(0.87, 4);
    expect(matches[0].match_percent).toBe(87);
    expect(matches[0].has_active_model).toBe(false);
    expect(matches[0].similar_hire_count).toBe(0);

    // Clamping
    expect(matches[1].match_percent).toBe(100);
    expect(matches[1].cosine_score).toBe(1);
    expect(matches[2].match_percent).toBe(0);
    expect(matches[2].cosine_score).toBe(0);

    // ISO conversion
    expect(matches[0].computed_at).toBe(now.toISOString());

    // Talent-Fit-service is wél aangeroepen, maar gaf has_active_model=false.
    expect(mockedPredict).toHaveBeenCalledTimes(3);
  });

  it('coerces string-encoded numeric score (pg numeric → string) into a finite number', async () => {
    const now = new Date();
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM jobs/i.test(sql)) {
          return { rows: [{ id: JOB_ID, has_embedding: true }], rowCount: 1 };
        }
        if (/FROM jobs j[\s\S]+JOIN candidates/i.test(sql)) {
          return {
            rows: [
              {
                candidate_id: CAND_ID,
                candidate_name: 'A',
                candidate_email: null,
                candidate_position: null,
                score: '0.5',
                ai_explanation: null,
                explanation_at: null,
                computed_at: now,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const [match] = await getJobMatches(TENANT_ID, JOB_ID, 5);
    expect(match.score).toBe(0.5);
    expect(match.cosine_score).toBe(0.5);
    expect(match.match_percent).toBe(50);
  });

  it('re-ranks candidates by combined_score when an active model exists', async () => {
    const now = new Date();
    // Initiële cosine-volgorde: A(0.9), B(0.7), C(0.5).
    // Active-model fit-scores: A=0.0, B=1.0, C=0.6.
    // combined = 0.6*cos + 0.4*fit:
    //   A = 0.54, B = 0.82, C = 0.54.
    // Verwacht: B → A → C (of B → C → A; A en C zijn 0.54 — gelijk; we
    // accepteren stable sort gedrag dus B eerst).
    setActiveModelWithFits({
      'cand-A': { fit: 0.0, similar: ['past-1'] },
      'cand-B': { fit: 1.0, similar: ['past-1', 'past-2', 'past-3'] },
      'cand-C': { fit: 0.6, similar: [] },
    });

    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM jobs/i.test(sql)) {
          return { rows: [{ id: JOB_ID, has_embedding: true }], rowCount: 1 };
        }
        if (/FROM jobs j[\s\S]+JOIN candidates/i.test(sql)) {
          return {
            rows: [
              {
                candidate_id: 'cand-A',
                candidate_name: 'Alice',
                candidate_email: null,
                candidate_position: null,
                score: 0.9,
                ai_explanation: null,
                explanation_at: null,
                computed_at: now,
              },
              {
                candidate_id: 'cand-B',
                candidate_name: 'Bob',
                candidate_email: null,
                candidate_position: null,
                score: 0.7,
                ai_explanation: null,
                explanation_at: null,
                computed_at: now,
              },
              {
                candidate_id: 'cand-C',
                candidate_name: 'Carol',
                candidate_email: null,
                candidate_position: null,
                score: 0.5,
                ai_explanation: null,
                explanation_at: null,
                computed_at: now,
              },
            ],
            rowCount: 3,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const matches = await getJobMatches(TENANT_ID, JOB_ID, 10);
    expect(matches).toHaveLength(3);
    expect(matches[0].candidate_name).toBe('Bob');
    expect(matches[0].fit_score).toBe(1.0);
    expect(matches[0].combined_score).toBeCloseTo(0.82, 4);
    expect(matches[0].match_percent).toBe(82);
    expect(matches[0].similar_hire_count).toBe(3);
    expect(matches[0].has_active_model).toBe(true);

    // Cosine_score blijft de raw waarde (niet de re-ranked).
    expect(matches[0].cosine_score).toBeCloseTo(0.7, 4);

    // De andere twee zijn onderling tie (combined = 0.54) — beide moeten
    // bestaan, in willekeurige tussen-volgorde.
    const remaining = matches.slice(1).map((m) => m.candidate_name).sort();
    expect(remaining).toEqual(['Alice', 'Carol']);
  });

  it('falls back to cosine for a row whose prediction throws (resilience)', async () => {
    const now = new Date();
    let call = 0;
    mockedPredict.mockImplementation(async (_tenant, _job, candidateId) => {
      call++;
      if (candidateId === 'cand-bad') {
        throw new Error('boom');
      }
      return {
        fit_score: 0.5,
        combined_score: 0,
        cosine_sim: 0,
        features: {} as never,
        similar_hires: [],
        has_active_model: true,
        model_id: 'm1',
      };
    });

    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM jobs/i.test(sql)) {
          return { rows: [{ id: JOB_ID, has_embedding: true }], rowCount: 1 };
        }
        if (/FROM jobs j[\s\S]+JOIN candidates/i.test(sql)) {
          return {
            rows: [
              {
                candidate_id: 'cand-good',
                candidate_name: 'Good',
                candidate_email: null,
                candidate_position: null,
                score: 0.6,
                ai_explanation: null,
                explanation_at: null,
                computed_at: now,
              },
              {
                candidate_id: 'cand-bad',
                candidate_name: 'Bad',
                candidate_email: null,
                candidate_position: null,
                score: 0.4,
                ai_explanation: null,
                explanation_at: null,
                computed_at: now,
              },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const matches = await getJobMatches(TENANT_ID, JOB_ID, 10);
    expect(call).toBe(2);
    const bad = matches.find((m) => m.candidate_name === 'Bad')!;
    expect(bad.fit_score).toBeNull();
    expect(bad.has_active_model).toBe(false);
    expect(bad.combined_score).toBeCloseTo(0.4, 4);
    const good = matches.find((m) => m.candidate_name === 'Good')!;
    expect(good.has_active_model).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getCandidateMatches — mirror of the job side
// ──────────────────────────────────────────────────────────────────────────────

describe('getCandidateMatches', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    setNoActiveModel();
  });

  afterEach(() => {
    teardown?.();
  });

  it('returns [] when the candidate has no embedding', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM candidates/i.test(sql)) {
          return {
            rows: [{ id: CAND_ID, has_embedding: false }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    expect(await getCandidateMatches(TENANT_ID, CAND_ID, 5)).toEqual([]);
    expect(mockedPredict).not.toHaveBeenCalled();
  });

  it('throws 404 when the candidate does not exist', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      getCandidateMatches(TENANT_ID, CAND_ID, 5)
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
  });

  it('returns jobs with computed match_percent (no model)', async () => {
    const now = new Date();
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID, has_embedding: true }], rowCount: 1 };
        }
        if (/FROM candidates c[\s\S]+JOIN jobs j/i.test(sql)) {
          return {
            rows: [
              {
                job_id: JOB_ID,
                job_title: 'Senior Engineer',
                job_status: 'open',
                score: 0.71,
                ai_explanation: null,
                explanation_at: null,
                computed_at: now,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const matches = await getCandidateMatches(TENANT_ID, CAND_ID, 5);
    expect(matches).toHaveLength(1);
    expect(matches[0].job_title).toBe('Senior Engineer');
    expect(matches[0].match_percent).toBe(71);
    expect(matches[0].fit_score).toBeNull();
    expect(matches[0].similar_hire_count).toBe(0);
    expect(matches[0].has_active_model).toBe(false);
  });

  it('caps the limit at 100 and defaults to 20 for bad inputs', async () => {
    let limitParam: number | undefined;
    client = mockClient({
      __matcher: (sql, params) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID, has_embedding: true }], rowCount: 1 };
        }
        if (/FROM candidates c[\s\S]+JOIN jobs j/i.test(sql)) {
          // 3rd param is the LIMIT
          limitParam = params[2] as number;
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await getCandidateMatches(TENANT_ID, CAND_ID, 9999);
    expect(limitParam).toBe(100);

    await getCandidateMatches(TENANT_ID, CAND_ID, -5);
    expect(limitParam).toBe(20);

    await getCandidateMatches(TENANT_ID, CAND_ID, NaN);
    expect(limitParam).toBe(20);
  });

  it('re-ranks jobs by combined_score with active model', async () => {
    const now = new Date();
    setActiveModelWithFits({
      [JOB_ID]: { fit: 0.2, similar: [] },
      'job-2': { fit: 0.95, similar: ['p1', 'p2'] },
    });

    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID, has_embedding: true }], rowCount: 1 };
        }
        if (/FROM candidates c[\s\S]+JOIN jobs j/i.test(sql)) {
          return {
            rows: [
              {
                job_id: JOB_ID,
                job_title: 'Cosine winner',
                job_status: 'open',
                score: 0.85,
                ai_explanation: null,
                explanation_at: null,
                computed_at: now,
              },
              {
                job_id: 'job-2',
                job_title: 'Combined winner',
                job_status: 'open',
                score: 0.65,
                ai_explanation: null,
                explanation_at: null,
                computed_at: now,
              },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    // setActiveModelWithFits keys op _job_-id (3e parameter is candidate, niet job).
    // Pas mock aan: predictForCandidateJob krijgt (tenant, jobId, candidateId, opts).
    mockedPredict.mockImplementation(async (_tenant, jobId) => {
      const map: Record<string, { fit: number; sim: number }> = {
        [JOB_ID]: { fit: 0.2, sim: 0 },
        'job-2': { fit: 0.95, sim: 2 },
      };
      const e = map[jobId] ?? { fit: 0, sim: 0 };
      return {
        fit_score: e.fit,
        combined_score: 0,
        cosine_sim: 0,
        features: {} as never,
        similar_hires: Array.from({ length: e.sim }, (_, i) => ({
          candidate_id: `p${i}`,
          candidate_name: 'past',
          job_title: null,
          hired_at: null,
          similarity: 0.9,
        })),
        has_active_model: true,
        model_id: 'm-active',
      };
    });

    const matches = await getCandidateMatches(TENANT_ID, CAND_ID, 5);
    // Combined: JOB_ID = 0.6*0.85 + 0.4*0.2 = 0.59
    //          job-2 = 0.6*0.65 + 0.4*0.95 = 0.77 → wint
    expect(matches[0].job_title).toBe('Combined winner');
    expect(matches[0].combined_score).toBeCloseTo(0.77, 4);
    expect(matches[0].match_percent).toBe(77);
    expect(matches[0].similar_hire_count).toBe(2);
    expect(matches[0].has_active_model).toBe(true);

    expect(matches[1].job_title).toBe('Cosine winner');
    expect(matches[1].fit_score).toBe(0.2);
  });
});

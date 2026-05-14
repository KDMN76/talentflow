/**
 * Agreement matrix unit tests — focus op de pure rekenkern
 * `computeAgreementMatrix`. End-to-end met DB-mock voor `getAgreementMatrix`
 * dekt het loading + parsing pad.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';
import {
  computeAgreementMatrix,
  getAgreementMatrix,
} from '../src/modules/scorecards/scorecards.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const APP_ID = '22222222-2222-2222-2222-222222222222';

describe('computeAgreementMatrix — pure', () => {
  it('returns empty structure when no scorecards', () => {
    const out = computeAgreementMatrix([]);
    expect(out.matrix).toEqual([]);
    expect(out.per_criterion).toEqual([]);
    expect(out.per_interviewer).toEqual([]);
    expect(out.outlier_interviewer).toBeNull();
  });

  it('computes per-criterion mean and std-dev', () => {
    const out = computeAgreementMatrix([
      {
        interviewer_id: 'a',
        interviewer_name: 'Alice',
        recommendation: 'yes',
        overall_score: 4,
        criteria_scores: [
          { criterion: 'comm', score: 4 },
          { criterion: 'tech', score: 5 },
        ],
      },
      {
        interviewer_id: 'b',
        interviewer_name: 'Bob',
        recommendation: 'yes',
        overall_score: 4,
        criteria_scores: [
          { criterion: 'comm', score: 4 },
          { criterion: 'tech', score: 5 },
        ],
      },
    ]);
    const comm = out.per_criterion.find((c) => c.criterion_key === 'comm');
    const tech = out.per_criterion.find((c) => c.criterion_key === 'tech');
    expect(comm?.mean).toBe(4);
    expect(comm?.std_dev).toBe(0);
    expect(comm?.consensus).toBe('strong');
    expect(tech?.mean).toBe(5);
  });

  it('classifies consensus correctly', () => {
    const strong = computeAgreementMatrix([
      {
        interviewer_id: 'a',
        interviewer_name: 'A',
        recommendation: null,
        overall_score: null,
        criteria_scores: [{ criterion: 'x', score: 4 }],
      },
      {
        interviewer_id: 'b',
        interviewer_name: 'B',
        recommendation: null,
        overall_score: null,
        criteria_scores: [{ criterion: 'x', score: 4.2 }],
      },
    ]);
    expect(strong.per_criterion[0].consensus).toBe('strong');

    const moderate = computeAgreementMatrix([
      {
        interviewer_id: 'a',
        interviewer_name: 'A',
        recommendation: null,
        overall_score: null,
        criteria_scores: [{ criterion: 'x', score: 3 }],
      },
      {
        interviewer_id: 'b',
        interviewer_name: 'B',
        recommendation: null,
        overall_score: null,
        criteria_scores: [{ criterion: 'x', score: 4 }],
      },
    ]);
    expect(moderate.per_criterion[0].consensus).toBe('moderate');

    const low = computeAgreementMatrix([
      {
        interviewer_id: 'a',
        interviewer_name: 'A',
        recommendation: null,
        overall_score: null,
        criteria_scores: [{ criterion: 'x', score: 1 }],
      },
      {
        interviewer_id: 'b',
        interviewer_name: 'B',
        recommendation: null,
        overall_score: null,
        criteria_scores: [{ criterion: 'x', score: 5 }],
      },
    ]);
    expect(low.per_criterion[0].consensus).toBe('low');
  });

  it('detects an outlier interviewer when mean abs deviation > 1.5 * group std-dev', () => {
    // 4 interviewers: 3 score ~4, 1 (Outlier) consistent low (~1).
    const out = computeAgreementMatrix([
      {
        interviewer_id: 'a',
        interviewer_name: 'A',
        recommendation: 'yes',
        overall_score: 4,
        criteria_scores: [
          { criterion: 'comm', score: 4 },
          { criterion: 'tech', score: 4 },
        ],
      },
      {
        interviewer_id: 'b',
        interviewer_name: 'B',
        recommendation: 'yes',
        overall_score: 4,
        criteria_scores: [
          { criterion: 'comm', score: 4 },
          { criterion: 'tech', score: 4 },
        ],
      },
      {
        interviewer_id: 'c',
        interviewer_name: 'C',
        recommendation: 'yes',
        overall_score: 4,
        criteria_scores: [
          { criterion: 'comm', score: 4 },
          { criterion: 'tech', score: 4 },
        ],
      },
      {
        interviewer_id: 'd',
        interviewer_name: 'Outlier',
        recommendation: 'no',
        overall_score: 1,
        criteria_scores: [
          { criterion: 'comm', score: 1 },
          { criterion: 'tech', score: 1 },
        ],
      },
    ]);
    expect(out.outlier_interviewer).not.toBeNull();
    expect(out.outlier_interviewer?.id).toBe('d');
    expect(out.outlier_interviewer?.name).toBe('Outlier');
  });

  it('does not flag outlier when consensus is tight (std-dev=0)', () => {
    const out = computeAgreementMatrix([
      {
        interviewer_id: 'a',
        interviewer_name: 'A',
        recommendation: null,
        overall_score: 4,
        criteria_scores: [{ criterion: 'x', score: 4 }],
      },
      {
        interviewer_id: 'b',
        interviewer_name: 'B',
        recommendation: null,
        overall_score: 4,
        criteria_scores: [{ criterion: 'x', score: 4 }],
      },
      {
        interviewer_id: 'c',
        interviewer_name: 'C',
        recommendation: null,
        overall_score: 4,
        criteria_scores: [{ criterion: 'x', score: 4 }],
      },
    ]);
    expect(out.outlier_interviewer).toBeNull();
  });

  it('skips outlier detection for panels with <3 interviewers', () => {
    const out = computeAgreementMatrix([
      {
        interviewer_id: 'a',
        interviewer_name: 'A',
        recommendation: null,
        overall_score: 5,
        criteria_scores: [{ criterion: 'x', score: 5 }],
      },
      {
        interviewer_id: 'b',
        interviewer_name: 'B',
        recommendation: null,
        overall_score: 1,
        criteria_scores: [{ criterion: 'x', score: 1 }],
      },
    ]);
    expect(out.outlier_interviewer).toBeNull();
  });

  it('handles missing criterion scores per interviewer', () => {
    const out = computeAgreementMatrix([
      {
        interviewer_id: 'a',
        interviewer_name: 'A',
        recommendation: null,
        overall_score: 4,
        criteria_scores: [{ criterion: 'comm', score: 4 }],
      },
      {
        interviewer_id: 'b',
        interviewer_name: 'B',
        recommendation: null,
        overall_score: 5,
        criteria_scores: [{ criterion: 'tech', score: 5 }],
      },
    ]);
    // Twee criteria-keys: comm en tech. Elke interviewer krijgt een rij voor
    // beide criteria — score=null waar ze het niet beoordeelden.
    expect(out.matrix.length).toBe(4);
    const aTech = out.matrix.find(
      (m) => m.interviewer_id === 'a' && m.criterion_key === 'tech'
    );
    const bComm = out.matrix.find(
      (m) => m.interviewer_id === 'b' && m.criterion_key === 'comm'
    );
    expect(aTech?.score).toBeNull();
    expect(bComm?.score).toBeNull();
  });

  it('uses overall_score as fallback when interviewer has no criteria scores', () => {
    const out = computeAgreementMatrix([
      {
        interviewer_id: 'a',
        interviewer_name: 'A',
        recommendation: 'yes',
        overall_score: 4.5,
        criteria_scores: [],
      },
    ]);
    expect(out.per_interviewer[0].mean_score).toBe(4.5);
  });
});

describe('getAgreementMatrix — DB integration', () => {
  let teardown: () => void;
  let client: MockClient;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('returns empty matrix when no submitted scorecards', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    const out = await getAgreementMatrix(TENANT, APP_ID);
    expect(out.matrix).toEqual([]);
  });

  it('parses JSON criteria_scores from DB', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM scorecards/i.test(sql)) {
          return {
            rows: [
              {
                id: 'sc-1',
                interviewer_id: 'a',
                interviewer_name: 'Alice',
                recommendation: 'yes',
                overall_score: '4.0',
                criteria_scores: '[{"criterion":"comm","score":4}]',
              },
              {
                id: 'sc-2',
                interviewer_id: 'b',
                interviewer_name: 'Bob',
                recommendation: 'yes',
                overall_score: '4.5',
                criteria_scores: '[{"criterion":"comm","score":5}]',
              },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const out = await getAgreementMatrix(TENANT, APP_ID);
    expect(out.per_criterion).toHaveLength(1);
    expect(out.per_criterion[0].mean).toBe(4.5);
    expect(out.per_interviewer).toHaveLength(2);
  });
});

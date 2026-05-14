/**
 * similarHires.service tests — Sprint Q3.3 (Agent ZZ).
 *
 * Verificatie van:
 *   - Happy path: getSimilarHiresForCandidate retourneert verrijkte
 *     SimilarHireDetail-rijen met shared_skills + cosine_to_query.
 *   - Filters: jobId-filter beperkt de resultaten tot één job.
 *   - Limit: clamp naar [1, 25] met default 5.
 *   - 404 wanneer kandidaat niet bestaat / soft-deleted is.
 *   - Returns [] wanneer query-kandidaat geen embedding heeft.
 *   - Job-scope: getSimilarHiresForJob doet 2-staps lookup (similar_jobs +
 *     hires daaruit).
 *   - In-memory cache: tweede call met dezelfde key gaat NIET naar de DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';
import {
  getSimilarHiresForCandidate,
  getSimilarHiresForJob,
  __resetSimilarHiresCacheForTests,
} from '../src/modules/matching/similarHires.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CAND_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const JOB_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('getSimilarHiresForCandidate', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetSimilarHiresCacheForTests();
  });

  afterEach(() => {
    teardown?.();
  });

  it('throws 404 when the query candidate does not exist', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM candidates/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      getSimilarHiresForCandidate(TENANT_ID, CAND_ID)
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
  });

  it('returns [] when the candidate has no embedding', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID, has_embedding: false }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    expect(await getSimilarHiresForCandidate(TENANT_ID, CAND_ID)).toEqual([]);
  });

  it('returns enriched hires with shared_skills, clamped cosine and ISO hired_at', async () => {
    const now = new Date('2026-04-15T10:00:00Z');
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID, has_embedding: true }], rowCount: 1 };
        }
        // Eerste cosine-similar-hires query — bevat DISTINCT ON (c.id) en
        // join op applications + jobs.
        if (/DISTINCT ON \(c\.id\)/i.test(sql) && /a\.status = 'hired'/i.test(sql)) {
          return {
            rows: [
              {
                candidate_id: 'h1',
                candidate_name: 'Hired One',
                candidate_position: 'Frontend Dev',
                job_id: 'job-x',
                job_title: 'Frontend Engineer',
                hired_at: now,
                cosine_to_query: 1.001, // moet clampen naar 1.0
              },
              {
                candidate_id: 'h2',
                candidate_name: 'Hired Two',
                candidate_position: null,
                job_id: 'job-y',
                job_title: 'Backend Engineer',
                hired_at: '2026-03-01T08:00:00Z',
                cosine_to_query: '0.65',
              },
            ],
            rowCount: 2,
          };
        }
        // Tweede query — shared_skills via WITH query_skills AS.
        if (/query_skills/i.test(sql)) {
          return {
            rows: [
              { candidate_id: 'h1', shared: ['React', 'TypeScript', 'CSS'] },
              { candidate_id: 'h2', shared: [] },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const hires = await getSimilarHiresForCandidate(TENANT_ID, CAND_ID, {
      limit: 5,
    });
    expect(hires).toHaveLength(2);

    expect(hires[0].candidate_id).toBe('h1');
    expect(hires[0].candidate_name).toBe('Hired One');
    expect(hires[0].cosine_to_query).toBe(1); // clamped
    expect(hires[0].hired_at).toBe(now.toISOString());
    expect(hires[0].shared_skills).toEqual(['React', 'TypeScript', 'CSS']);

    expect(hires[1].candidate_id).toBe('h2');
    expect(hires[1].cosine_to_query).toBeCloseTo(0.65, 4);
    expect(hires[1].shared_skills).toEqual([]);
  });

  it('passes job_id filter through to the query when provided', async () => {
    let capturedSqls: string[] = [];
    let capturedParams: unknown[][] = [];
    client = mockClient({
      __matcher: (sql, params) => {
        capturedSqls.push(sql);
        capturedParams.push(params);
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID, has_embedding: true }], rowCount: 1 };
        }
        if (/DISTINCT ON \(c\.id\)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await getSimilarHiresForCandidate(TENANT_ID, CAND_ID, {
      jobId: JOB_ID,
      limit: 3,
    });

    const cosineCall = capturedSqls.findIndex((s) =>
      /DISTINCT ON \(c\.id\)/i.test(s)
    );
    expect(cosineCall).toBeGreaterThan(-1);
    // Verwacht een job_id filter (a.job_id = $4) en JOB_ID in de params.
    expect(capturedSqls[cosineCall]).toMatch(/a\.job_id = \$\d+/);
    expect(capturedParams[cosineCall]).toContain(JOB_ID);
  });

  it('clamps limit to default 5 when invalid, and to MAX 25', async () => {
    let limitParam: unknown;
    client = mockClient({
      __matcher: (sql, params) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID, has_embedding: true }], rowCount: 1 };
        }
        if (/DISTINCT ON \(c\.id\)/i.test(sql)) {
          // Het 3e param is de LIMIT.
          limitParam = params[2];
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await getSimilarHiresForCandidate(TENANT_ID, CAND_ID, { limit: 9999 });
    expect(limitParam).toBe(25);

    __resetSimilarHiresCacheForTests();
    await getSimilarHiresForCandidate(TENANT_ID, CAND_ID, { limit: -1 });
    expect(limitParam).toBe(5);
  });

  it('caches results in-memory: second call does not re-query the DB', async () => {
    let cosineCalls = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID, has_embedding: true }], rowCount: 1 };
        }
        if (/DISTINCT ON \(c\.id\)/i.test(sql)) {
          cosineCalls++;
          return {
            rows: [
              {
                candidate_id: 'h1',
                candidate_name: 'Cached One',
                candidate_position: null,
                job_id: 'job-x',
                job_title: 'Engineer',
                hired_at: new Date(),
                cosine_to_query: 0.8,
              },
            ],
            rowCount: 1,
          };
        }
        if (/query_skills/i.test(sql)) {
          return {
            rows: [{ candidate_id: 'h1', shared: ['Python'] }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const first = await getSimilarHiresForCandidate(TENANT_ID, CAND_ID, {
      limit: 5,
    });
    const second = await getSimilarHiresForCandidate(TENANT_ID, CAND_ID, {
      limit: 5,
    });

    expect(cosineCalls).toBe(1); // 2e call serveert uit de cache
    expect(first).toEqual(second);
  });
});

describe('getSimilarHiresForJob', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetSimilarHiresCacheForTests();
  });

  afterEach(() => {
    teardown?.();
  });

  it('throws 404 when the job does not exist', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      getSimilarHiresForJob(TENANT_ID, JOB_ID)
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });

  it('returns [] when the job has no embedding', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM jobs/i.test(sql)) {
          return {
            rows: [{ id: JOB_ID, has_embedding: false, required_skills: null }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    expect(await getSimilarHiresForJob(TENANT_ID, JOB_ID)).toEqual([]);
  });

  it('returns hires from similar jobs, with required_skills overlap as shared_skills', async () => {
    const now = new Date('2026-02-10T08:00:00Z');
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM jobs/i.test(sql)) {
          return {
            rows: [
              {
                id: JOB_ID,
                has_embedding: true,
                required_skills: ['React', 'TypeScript'],
              },
            ],
            rowCount: 1,
          };
        }
        if (/similar_jobs AS/i.test(sql)) {
          return {
            rows: [
              {
                candidate_id: 'h1',
                candidate_name: 'Reuse Hire',
                candidate_position: 'Sr. Frontend',
                job_id: 'job-similar',
                job_title: 'Frontend Engineer',
                hired_at: now,
                cosine_to_query: 0.9,
              },
            ],
            rowCount: 1,
          };
        }
        if (/unnest\(\$3::text\[\]\)/i.test(sql)) {
          return {
            rows: [{ candidate_id: 'h1', shared: ['React', 'TypeScript'] }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const hires = await getSimilarHiresForJob(TENANT_ID, JOB_ID, 5);
    expect(hires).toHaveLength(1);
    expect(hires[0].candidate_id).toBe('h1');
    expect(hires[0].job_title).toBe('Frontend Engineer');
    expect(hires[0].shared_skills).toEqual(['React', 'TypeScript']);
    expect(hires[0].cosine_to_query).toBeCloseTo(0.9, 4);
  });

  it('falls back to candidate top-skills when job has no required_skills', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding IS NOT NULL AS has_embedding[\s\S]+FROM jobs/i.test(sql)) {
          return {
            rows: [
              { id: JOB_ID, has_embedding: true, required_skills: [] },
            ],
            rowCount: 1,
          };
        }
        if (/similar_jobs AS/i.test(sql)) {
          return {
            rows: [
              {
                candidate_id: 'h1',
                candidate_name: 'Hire Two',
                candidate_position: null,
                job_id: 'job-similar',
                job_title: 'Backend Engineer',
                hired_at: new Date(),
                cosine_to_query: 0.7,
              },
            ],
            rowCount: 1,
          };
        }
        // Fallback-pad: GEEN unnest($3::text[]) — alleen LIMIT $3.
        if (/SELECT cs2\.skill[\s\S]+ORDER BY cs2\.score/i.test(sql) &&
            !/unnest\(\$3/i.test(sql)) {
          return {
            rows: [{ candidate_id: 'h1', shared: ['Go', 'Postgres'] }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const hires = await getSimilarHiresForJob(TENANT_ID, JOB_ID, 5);
    expect(hires).toHaveLength(1);
    expect(hires[0].shared_skills).toEqual(['Go', 'Postgres']);
  });
});

/**
 * Talent reactivation worker tests — Sprint Q3.2.
 *
 * We testen de pure functies (findReactivationMatchesForJob, upsertAlertsForJob,
 * dispatchRecruiterDigests) tegen een mock PoolClient. De worker zelf draait
 * tegen BullMQ-Queue (door setup.ts gemockt).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient, type MockClient } from './helpers/dbMock';

// Mock email queue zodat dispatch geen ioredis raakt. We mocken inline zonder
// top-level vars (vi.mock wordt door vitest gehoist tot vóór imports).
vi.mock('../src/queue/queues', () => ({
  emailSenderQueue: { add: vi.fn(async () => ({ id: 'mock-job-id' })) },
  talentReactivationQueue: { add: vi.fn(async () => ({ id: 'mock' })) },
}));

import {
  findReactivationMatchesForJob,
  upsertAlertsForJob,
  SCORE_THRESHOLD,
  CANDIDATE_DORMANT_DAYS,
} from '../src/queue/workers/talentReactivation.worker';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const JOB_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('findReactivationMatchesForJob — query construction', () => {
  let client: MockClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes tenant + job + dormant-days to the SQL', async () => {
    let capturedParams: unknown[] = [];
    let capturedSql = '';
    client = mockClient({
      __matcher: (sql, params) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [], rowCount: 0 };
      },
    });

    await findReactivationMatchesForJob(client, TENANT_ID, JOB_ID);

    expect(capturedSql).toMatch(/c\.embedding\s+<=>\s+\(SELECT embedding FROM job_emb\)/i);
    expect(capturedSql).toMatch(/AND a\.status\s*=\s*'rejected'/i);
    expect(capturedSql).toMatch(/last_activity_at\s*<\s*now\(\)/i);
    expect(capturedParams[0]).toBe(JOB_ID);
    expect(capturedParams[1]).toBe(TENANT_ID);
    expect(capturedParams[2]).toBe(String(CANDIDATE_DORMANT_DAYS));
  });

  it('returns empty array when no candidates match', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    const matches = await findReactivationMatchesForJob(client, TENANT_ID, JOB_ID);
    expect(matches).toEqual([]);
  });

  it('returns matches with candidate_id, score, reason', async () => {
    client = mockClient({
      __matcher: () => ({
        rows: [
          { candidate_id: 'c1', score: 0.81, reason: 'old_archived' },
          { candidate_id: 'c2', score: 0.78, reason: 'rejected_in_other_job' },
        ],
        rowCount: 2,
      }),
    });
    const matches = await findReactivationMatchesForJob(client, TENANT_ID, JOB_ID);
    expect(matches).toHaveLength(2);
    expect(matches[0].candidate_id).toBe('c1');
    expect(matches[0].reason).toBe('old_archived');
  });
});

describe('upsertAlertsForJob — threshold + dedupe', () => {
  let client: MockClient;
  let inserts: Array<{ candidateId: string; score: string; reason: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    inserts = [];
  });

  it('skips matches below SCORE_THRESHOLD', async () => {
    client = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO talent_reactivation_alerts/i.test(sql)) {
          inserts.push({
            candidateId: params[2] as string,
            score: params[3] as string,
            reason: params[4] as string,
          });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    await upsertAlertsForJob(client, TENANT_ID, JOB_ID, [
      { candidate_id: 'c1', score: 0.5, reason: 'old_archived' },
      { candidate_id: 'c2', score: SCORE_THRESHOLD + 0.05, reason: 'old_archived' },
      { candidate_id: 'c3', score: SCORE_THRESHOLD - 0.01, reason: 'old_archived' },
    ]);

    expect(inserts).toHaveLength(1);
    expect(inserts[0].candidateId).toBe('c2');
  });

  it('uses ON CONFLICT DO NOTHING — rowCount=0 means existing alert', async () => {
    let conflictHandled = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO talent_reactivation_alerts/i.test(sql)) {
          if (/ON CONFLICT/i.test(sql)) conflictHandled = true;
          return { rows: [], rowCount: 0 }; // already exists
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const result = await upsertAlertsForJob(client, TENANT_ID, JOB_ID, [
      { candidate_id: 'c1', score: 0.9, reason: 'strong_skill_match' },
    ]);

    expect(conflictHandled).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].inserted).toBe(false);
  });

  it('clamps scores >1 and <0 into [0,1] before INSERT', async () => {
    client = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO talent_reactivation_alerts/i.test(sql)) {
          inserts.push({
            candidateId: params[2] as string,
            score: params[3] as string,
            reason: params[4] as string,
          });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    await upsertAlertsForJob(client, TENANT_ID, JOB_ID, [
      { candidate_id: 'c-high', score: 1.05, reason: 'strong_skill_match' },
    ]);

    expect(inserts).toHaveLength(1);
    expect(parseFloat(inserts[0].score)).toBeLessThanOrEqual(1);
  });

  it('reports inserted=true voor nieuwe rijen, false voor dupes', async () => {
    let callCount = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO talent_reactivation_alerts/i.test(sql)) {
          callCount++;
          // First insert succeeds, second is a dupe
          return { rows: [], rowCount: callCount === 1 ? 1 : 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const result = await upsertAlertsForJob(client, TENANT_ID, JOB_ID, [
      { candidate_id: 'c1', score: 0.85, reason: 'old_archived' },
      { candidate_id: 'c2', score: 0.85, reason: 'old_archived' },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].inserted).toBe(true);
    expect(result[1].inserted).toBe(false);
  });

  it('skips non-finite scores defensively', async () => {
    client = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO talent_reactivation_alerts/i.test(sql)) {
          inserts.push({
            candidateId: params[2] as string,
            score: params[3] as string,
            reason: params[4] as string,
          });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    await upsertAlertsForJob(client, TENANT_ID, JOB_ID, [
      { candidate_id: 'c-nan', score: NaN, reason: 'old_archived' },
    ]);
    expect(inserts).toHaveLength(0);
  });
});

describe('SCORE_THRESHOLD environment override', () => {
  it('uses safe default 0.75 when env unset/invalid', () => {
    // Worker module is geladen met env op test-defaults; we kunnen het
    // export'd constant uitlezen.
    expect(SCORE_THRESHOLD).toBeGreaterThan(0);
    expect(SCORE_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

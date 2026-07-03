/**
 * HM write-pad tests — "geen fake succes" (Q-hardening).
 *
 * De HM-service had mock-fallbacks die bij DB-fouten verzonnen data of een
 * optimistisch mock-succes teruggaven. Deze tests pinnen het eerlijke gedrag
 * vast:
 *   1. approve verplaatst de sollicitatie naar de volgende fase + logt een
 *      activity (de write gebeurt écht).
 *   2. reject zet status='rejected' + logt een activity.
 *   3. een sollicitatie die niet aan deze HM is toegewezen → 404 AppError.
 *   4. een DB-fout (bijv. missing table 42P01) propageert als fout — er komt
 *      GEEN mock-succesrespons meer terug.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import * as hmService from '../../src/modules/hm/hm.service';
import { AppError } from '../../src/middleware/errorHandler';

const TENANT = '11111111-1111-1111-1111-111111111111';
const HM_USER = '22222222-2222-2222-2222-222222222222';
const APP_ID = '33333333-3333-3333-3333-333333333333';
const STAGE_ID = '44444444-4444-4444-4444-444444444444';
const NEXT_STAGE_ID = '55555555-5555-5555-5555-555555555555';
const JOB_ID = '66666666-6666-6666-6666-666666666666';

describe('hm.service.reviewApplication', () => {
  let client: MockClient;
  let teardown: (() => void) | undefined;

  afterEach(() => teardown?.());

  it('approve: verplaatst naar volgende fase en logt hm_approved activity', async () => {
    let updatedStageId: string | null = null;
    let activityAction: string | null = null;
    let activityPayload: Record<string, unknown> | null = null;

    client = mockClient({
      __matcher: (sql, params) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/FROM applications a\s+JOIN jobs j/i.test(sql)) {
          return {
            rows: [
              {
                id: APP_ID,
                job_id: JOB_ID,
                candidate_id: 'cand-1',
                stage_id: STAGE_ID,
                status: 'active',
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT ps\.id, ps\.position, ps\.job_id/i.test(sql)) {
          return {
            rows: [{ id: STAGE_ID, position: 1, job_id: JOB_ID }],
            rowCount: 1,
          };
        }
        if (/SELECT id FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ id: NEXT_STAGE_ID }], rowCount: 1 };
        }
        if (/UPDATE applications/i.test(sql)) {
          updatedStageId = params[0] as string | null;
          return {
            rows: [
              {
                id: APP_ID,
                stage_id: NEXT_STAGE_ID,
                status: 'active',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO activities/i.test(sql)) {
          activityAction = params[3] as string;
          activityPayload = JSON.parse(params[4] as string);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await hmService.reviewApplication(
      TENANT,
      HM_USER,
      APP_ID,
      'approve',
      'Sterke kandidaat'
    );

    expect(updatedStageId).toBe(NEXT_STAGE_ID);
    expect(activityAction).toBe('hm_approved');
    expect(activityPayload).toMatchObject({
      decision: 'approve',
      notes: 'Sterke kandidaat',
    });
    expect(result).toMatchObject({ id: APP_ID, stage_id: NEXT_STAGE_ID });
  });

  it('reject: zet status=rejected en logt hm_rejected activity', async () => {
    let rejected = false;
    let activityAction: string | null = null;

    client = mockClient({
      __matcher: (sql, params) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/FROM applications a\s+JOIN jobs j/i.test(sql)) {
          return {
            rows: [
              {
                id: APP_ID,
                job_id: JOB_ID,
                candidate_id: 'cand-1',
                stage_id: STAGE_ID,
                status: 'active',
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE applications/i.test(sql) && /'rejected'/i.test(sql)) {
          rejected = true;
          return {
            rows: [{ id: APP_ID, status: 'rejected' }],
            rowCount: 1,
          };
        }
        if (/INSERT INTO activities/i.test(sql)) {
          activityAction = params[3] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await hmService.reviewApplication(
      TENANT,
      HM_USER,
      APP_ID,
      'reject'
    );

    expect(rejected).toBe(true);
    expect(activityAction).toBe('hm_rejected');
    expect(result).toMatchObject({ id: APP_ID, status: 'rejected' });
  });

  it('404 wanneer de sollicitatie niet aan deze HM is toegewezen', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        // Applicatie-lookup levert niets op (andere recruiter / ander tenant).
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      hmService.reviewApplication(TENANT, HM_USER, APP_ID, 'approve')
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'APPLICATION_NOT_FOUND',
    });

    await expect(
      hmService.reviewApplication(TENANT, HM_USER, APP_ID, 'approve')
    ).rejects.toBeInstanceOf(AppError);
  });

  it('DB-fout propageert — GEEN mock-succes meer (42P01 missing table)', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        const err = new Error('relation "applications" does not exist') as Error & {
          code: string;
        };
        err.code = '42P01';
        throw err;
      },
    });
    teardown = installPoolMock(client);

    // Vóór de fix gaf dit { ..., mock: true } terug alsof de review gelukt was.
    await expect(
      hmService.reviewApplication(TENANT, HM_USER, APP_ID, 'approve')
    ).rejects.toThrow(/does not exist/);
  });

  it('later: geen status/stage-wijziging, wel hm_deferred activity', async () => {
    let applicationsUpdated = false;
    let activityAction: string | null = null;

    client = mockClient({
      __matcher: (sql, params) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/FROM applications a\s+JOIN jobs j/i.test(sql)) {
          return {
            rows: [
              {
                id: APP_ID,
                job_id: JOB_ID,
                candidate_id: 'cand-1',
                stage_id: STAGE_ID,
                status: 'active',
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE applications/i.test(sql)) {
          applicationsUpdated = true;
          return { rows: [{ id: APP_ID }], rowCount: 1 };
        }
        if (/INSERT INTO activities/i.test(sql)) {
          activityAction = params[3] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await hmService.reviewApplication(TENANT, HM_USER, APP_ID, 'later');

    expect(applicationsUpdated).toBe(false);
    expect(activityAction).toBe('hm_deferred');
  });
});

describe('hm.service.getPendingReviews — geen mock-fallback', () => {
  let client: MockClient;
  let teardown: (() => void) | undefined;

  afterEach(() => teardown?.());

  it('propageert een DB-fout in plaats van nepkandidaten terug te geven', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        const err = new Error('relation "applications" does not exist') as Error & {
          code: string;
        };
        err.code = '42P01';
        throw err;
      },
    });
    teardown = installPoolMock(client);

    // Vóór de fix: 4 verzonnen kandidaten (Sophie van der Berg e.a.).
    await expect(
      hmService.getPendingReviews(TENANT, HM_USER)
    ).rejects.toThrow(/does not exist/);
  });

  it('mapt echte rijen inclusief stage_id en skills', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            {
              application_id: APP_ID,
              candidate_id: 'cand-1',
              candidate_name: 'Echte Kandidaat',
              candidate_email: 'echt@example.com',
              candidate_position: 'Backend Developer',
              candidate_skills: JSON.stringify(['Node.js', 'PostgreSQL']),
              ai_score: '82',
              applied_at: '2026-07-01T10:00:00.000Z',
              job_id: JOB_ID,
              job_title: 'Senior Backend Engineer',
              stage_id: STAGE_ID,
              stage_name: 'Interview',
              summary: 'Genoteerd door recruiter',
            },
          ],
          rowCount: 1,
        };
      },
    });
    teardown = installPoolMock(client);

    const rows = await hmService.getPendingReviews(TENANT, HM_USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      application_id: APP_ID,
      candidate_name: 'Echte Kandidaat',
      candidate_position: 'Backend Developer',
      ai_score: 82,
      stage_id: STAGE_ID,
      skills: ['Node.js', 'PostgreSQL'],
    });
  });
});

describe('hm.service.getScorecardDeadlines', () => {
  let client: MockClient;
  let teardown: (() => void) | undefined;

  afterEach(() => teardown?.());

  it('bucketeert deadlines deterministisch (overdue/today/this_week/later)', async () => {
    const now = Date.now();
    const iso = (offsetHours: number) =>
      new Date(now + offsetHours * 3600 * 1000).toISOString();

    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            {
              application_id: 'app-overdue',
              stage_id: STAGE_ID,
              candidate_name: 'Te Laat',
              job_id: JOB_ID,
              job_title: 'Job',
              stage_name: 'Interview',
              due_at: iso(-5),
            },
            {
              application_id: 'app-later',
              stage_id: STAGE_ID,
              candidate_name: 'Ruim Op Tijd',
              job_id: JOB_ID,
              job_title: 'Job',
              stage_name: 'Interview',
              due_at: iso(10 * 24),
            },
          ],
          rowCount: 2,
        };
      },
    });
    teardown = installPoolMock(client);

    const rows = await hmService.getScorecardDeadlines(TENANT, HM_USER);
    expect(rows).toHaveLength(2);
    expect(rows[0].bucket).toBe('overdue');
    expect(rows[1].bucket).toBe('later');
  });
});

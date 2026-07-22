/**
 * Authenticated pipeline routes happy-path tests — systeem-audit bugklasse 3
 * ("het laatste draadje").
 *
 * Gaat door de ECHTE HTTP-routes van de pipeline-module, inclusief
 * requireAuth + tenantMiddleware + requirePermission-middleware:
 *   - recruiter: kernmutaties (application aanmaken + stage-move) → 2xx
 *   - viewer:    mutaties → 403 INSUFFICIENT_PERMISSION (guard aanwezig)
 *   - zonder JWT → 401
 *
 * Service-gedrag zelf is gedekt in de pipeline service-tests; hier testen we
 * uitsluitend dat de route-keten (auth → tenant → permission → controller)
 * end-to-end klopt.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import pipelineRouter from '../../src/modules/pipeline/pipeline.router';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const JOB_ID = '33333333-3333-3333-3333-333333333333';
const CAND_ID = '44444444-4444-4444-4444-444444444444';
const STAGE_ID = '55555555-5555-5555-5555-555555555555';
const NEW_STAGE_ID = '66666666-6666-6666-6666-666666666666';
const APP_ID = '77777777-7777-7777-7777-777777777777';

function jwtTokenForRole(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'u@x.nl', role },
    process.env.JWT_SECRET!
  );
}

/** requirePermission(...) looks up the user's role (+ any custom-role
 * assignments) before the route handler runs. This matcher answers those
 * two queries and delegates the rest to the per-test `extra` matcher. */
function withRoleMatcher(
  role: string,
  extra?: (sql: string) => { rows: unknown[]; rowCount: number } | undefined
) {
  return async (sql: string) => {
    if (/FROM\s+users\b/i.test(sql)) return { rows: [{ role }], rowCount: 1 };
    if (/FROM\s+user_role_assignments\b/i.test(sql)) return { rows: [], rowCount: 0 };
    const extraResult = extra?.(sql);
    if (extraResult) return extraResult;
    return { rows: [], rowCount: 0 };
  };
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Same mount path as src/index.ts: app.use('/api/pipeline', pipelineRouter)
  app.use('/api/pipeline', pipelineRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JWT gating — zonder token altijd 401', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /jobs/:jobId/stages zonder JWT → 401', async () => {
    teardown = installPoolMock(mockClient({}));
    const r = await request(buildApp()).get(`/api/pipeline/jobs/${JOB_ID}/stages`);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /applications zonder JWT → 401', async () => {
    teardown = installPoolMock(mockClient({}));
    const r = await request(buildApp())
      .post('/api/pipeline/applications')
      .send({ job_id: JOB_ID, candidate_id: CAND_ID });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('PATCH /applications/:id zonder JWT → 401', async () => {
    teardown = installPoolMock(mockClient({}));
    const r = await request(buildApp())
      .patch(`/api/pipeline/applications/${APP_ID}`)
      .send({ stage_id: NEW_STAGE_ID });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('recruiter happy path — kernmutaties → 2xx', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /applications als recruiter → 201 met de nieuwe application', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/FROM\s+jobs\b/i.test(sql)) {
          return { rows: [{ id: JOB_ID }], rowCount: 1 };
        }
        if (/FROM\s+candidates\b/i.test(sql)) {
          return { rows: [{ id: CAND_ID }], rowCount: 1 };
        }
        // Eerste stage-lookup (geen stage_id meegegeven)
        if (/FROM\s+pipeline_stages\b/i.test(sql)) {
          return { rows: [{ id: STAGE_ID }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+applications\b/i.test(sql)) {
          return {
            rows: [
              {
                id: APP_ID,
                tenant_id: TENANT_ID,
                job_id: JOB_ID,
                candidate_id: CAND_ID,
                stage_id: STAGE_ID,
                status: 'active',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+activities\b/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .post('/api/pipeline/applications')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send({ job_id: JOB_ID, candidate_id: CAND_ID });

    expect(r.status).toBe(201);
    expect(r.body.id).toBe(APP_ID);
    expect(r.body.stage_id).toBe(STAGE_ID);
  });

  it('PATCH /applications/:id (stage-move) als recruiter → 200', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        // Bestaande application ophalen
        if (/FROM\s+applications\b/i.test(sql)) {
          return {
            rows: [
              {
                id: APP_ID,
                stage_id: STAGE_ID,
                status: 'active',
                candidate_id: CAND_ID,
                job_id: JOB_ID,
              },
            ],
            rowCount: 1,
          };
        }
        // Stage-validatie (JOIN met applications) + achtergrond-naamlookup.
        // 'Screening' staat NIET in HM_REVIEW_STAGE_NAMES → geen push-flow.
        if (/FROM\s+pipeline_stages\b/i.test(sql)) {
          return { rows: [{ id: NEW_STAGE_ID, name: 'Screening' }], rowCount: 1 };
        }
        if (/UPDATE\s+applications\b/i.test(sql)) {
          return {
            rows: [
              {
                id: APP_ID,
                tenant_id: TENANT_ID,
                job_id: JOB_ID,
                candidate_id: CAND_ID,
                stage_id: NEW_STAGE_ID,
                status: 'active',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+activities\b/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .patch(`/api/pipeline/applications/${APP_ID}`)
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send({ stage_id: NEW_STAGE_ID });

    expect(r.status).toBe(200);
    expect(r.body.id).toBe(APP_ID);
    expect(r.body.stage_id).toBe(NEW_STAGE_ID);
  });
});

describe('viewer gating — mutaties → 403, reads blijven open', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /applications als viewer → 403 INSUFFICIENT_PERMISSION', async () => {
    teardown = installPoolMock(mockClient({ __matcher: withRoleMatcher('viewer') }));
    const r = await request(buildApp())
      .post('/api/pipeline/applications')
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`)
      .send({ job_id: JOB_ID, candidate_id: CAND_ID });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    expect(r.body.error.details.required).toEqual({
      resource: 'applications',
      action: 'write',
    });
  });

  it('PATCH /applications/:id als viewer → 403 INSUFFICIENT_PERMISSION', async () => {
    teardown = installPoolMock(mockClient({ __matcher: withRoleMatcher('viewer') }));
    const r = await request(buildApp())
      .patch(`/api/pipeline/applications/${APP_ID}`)
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`)
      .send({ stage_id: NEW_STAGE_ID });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
  });

  it('POST /jobs/:jobId/stages als viewer → 403 (jobs:write vereist)', async () => {
    teardown = installPoolMock(mockClient({ __matcher: withRoleMatcher('viewer') }));
    const r = await request(buildApp())
      .post(`/api/pipeline/jobs/${JOB_ID}/stages`)
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`)
      .send({ name: 'Extra fase' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    expect(r.body.error.details.required).toEqual({
      resource: 'jobs',
      action: 'write',
    });
  });

  it('GET /jobs/:jobId/stages als viewer → 200 (read-route heeft geen write-guard)', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('viewer', (sql) => {
        if (/FROM\s+jobs\b/i.test(sql)) {
          return { rows: [{ id: JOB_ID }], rowCount: 1 };
        }
        if (/FROM\s+pipeline_stages\b/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .get(`/api/pipeline/jobs/${JOB_ID}/stages`)
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });
});

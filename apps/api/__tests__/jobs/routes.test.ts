/**
 * Authenticated jobs routes happy-path tests — systeem-audit bugklasse 3
 * ("het laatste draadje").
 *
 * Draait door de ECHTE HTTP-route-stack van de jobs-module: requireAuth →
 * tenantMiddleware → requireWriteOnMutation('jobs') → enforcePayTransparency →
 * controller → service, met alleen de pg-pool gemockt (dbMock helper).
 *
 * Dekking:
 *   - recruiter: POST /            → 201 (create draft)
 *   - recruiter: GET  /:id         → 200 (JobDetailSchema-conforme response)
 *   - viewer:    POST /            → 403 INSUFFICIENT_PERMISSION
 *   - zonder JWT: POST + GET       → 401
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

import jobsRouter from '../../src/modules/jobs/jobs.router';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const JOB_ID = '33333333-3333-3333-3333-333333333333';
const TEMPLATE_ID = '44444444-4444-4444-4444-444444444444';
const STAGE_ID = '55555555-5555-5555-5555-555555555555';

function jwtTokenForRole(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'u@x.nl', role },
    process.env.JWT_SECRET!
  );
}

/** requireWriteOnMutation('jobs') → requirePermission('jobs','write') doet op
 * elke mutatie een rol-lookup (users.role + user_role_assignments) vóór de
 * route handler draait. Deze matcher vangt die twee queries af; al het
 * overige gaat naar de optionele `extra` matcher. (Gekopieerd patroon uit
 * __tests__/whatsapp/routes.test.ts.) */
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

/**
 * Volledige jobs-row zoals de expliciete kolomprojectie (JOB_RETURNING_COLUMNS
 * / getJob-SELECT) hem oplevert. GET /:id valideert in test-mode strikt tegen
 * JobDetailSchema (assertResponse), dus exact deze sleutels — niets extra.
 */
function jobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: JOB_ID,
    tenant_id: TENANT_ID,
    title: 'Senior Backend Engineer',
    description: null,
    department: null,
    location: null,
    salary_min: null,
    salary_max: null,
    employment_type: 'fulltime',
    status: 'draft',
    recruiter_id: null,
    organization_id: null,
    deleted_at: null,
    created_at: '2026-07-22T10:00:00.000Z',
    updated_at: '2026-07-22T10:00:00.000Z',
    job_reference: 'JOB-ABC234',
    headcount: 1,
    experience_level: null,
    contract_type: null,
    contract_details: null,
    open_date: null,
    close_date: null,
    industry: null,
    remote_type: null,
    office_address: null,
    package_details: null,
    currency: 'EUR',
    salary_frequency: 'monthly',
    required_skills: [],
    nice_to_have_skills: [],
    pay_transparency_required: true,
    salary_band_disclosed: false,
    compensation_criteria: null,
    ...overrides,
  };
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Zelfde mount-pad als src/index.ts: app.use('/api/jobs', jobsRouter)
  app.use('/api/jobs', jobsRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JWT gating', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /api/jobs without JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/jobs')
      .send({ title: 'Nieuwe vacature' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/jobs/:id without JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).get(`/api/jobs/${JOB_ID}`);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('recruiter happy path', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /api/jobs as recruiter → 201 with created job', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        // INSERT … RETURNING — de aangemaakte job-row
        if (/INSERT\s+INTO\s+jobs\b/i.test(sql)) {
          return { rows: [jobRow()], rowCount: 1 };
        }
        // resolvePipelineTemplateId → default template lookup
        if (/FROM\s+pipeline_templates\b/i.test(sql)) {
          return { rows: [{ id: TEMPLATE_ID }], rowCount: 1 };
        }
        // instantiateTemplateStagesForJob → stage-kloon
        if (/INSERT\s+INTO\s+pipeline_stages\b/i.test(sql)) {
          return { rows: [], rowCount: 3 };
        }
        // idempotency-guard: COUNT(*) op bestaande stages
        if (/FROM\s+pipeline_stages\b/i.test(sql)) {
          return { rows: [{ n: 0 }], rowCount: 1 };
        }
        // activities-insert + overige (webhook fan-out etc.) → ack
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .post('/api/jobs')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send({ title: 'Senior Backend Engineer' });

    expect(r.status).toBe(201);
    expect(r.body.id).toBe(JOB_ID);
    expect(r.body.title).toBe('Senior Backend Engineer');
    expect(r.body.status).toBe('draft');
  });

  it('GET /api/jobs/:id as recruiter → 200 with job detail + stages', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        // getJob hoofd-query (FROM jobs j LEFT JOIN users u — matcht NIET op
        // /FROM users/, dus de rol-branch hierboven blijft erbuiten)
        if (/FROM\s+jobs\s+j\b/i.test(sql)) {
          return {
            rows: [jobRow({ recruiter_name: null })],
            rowCount: 1,
          };
        }
        // stages-hydration query
        if (/FROM\s+pipeline_stages\s+ps\b/i.test(sql)) {
          return {
            rows: [
              {
                id: STAGE_ID,
                name: 'Sourced',
                position: 0,
                color: '#6366f1',
                // COUNT() komt als string uit pg → schema coercet
                application_count: '2',
              },
            ],
            rowCount: 1,
          };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .get(`/api/jobs/${JOB_ID}`)
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`);

    expect(r.status).toBe(200);
    expect(r.body.id).toBe(JOB_ID);
    expect(r.body.title).toBe('Senior Backend Engineer');
    expect(r.body.stages).toHaveLength(1);
    expect(r.body.stages[0].name).toBe('Sourced');
    expect(r.body.stages[0].application_count).toBe(2);
  });
});

describe('permission gating — requireWriteOnMutation(jobs)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /api/jobs as viewer → 403 INSUFFICIENT_PERMISSION', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('viewer') });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .post('/api/jobs')
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`)
      .send({ title: 'Mag niet' });

    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    expect(r.body.error.details.required).toEqual({
      resource: 'jobs',
      action: 'write',
    });
  });
});

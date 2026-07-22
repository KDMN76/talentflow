/**
 * Authenticated candidates routes smoke tests — systeem-audit bugklasse 3
 * ("het laatste draadje").
 *
 * Draait door de ECHTE HTTP-routes van de candidates-module, inclusief
 * requireAuth + tenantMiddleware + requirePermission-middleware:
 *
 *   - recruiter: POST /            → 201 (kandidaat aangemaakt)
 *   - recruiter: GET  /:id         → 200 (kandidaat + gehydrateerde subresources)
 *   - viewer:    POST /            → 403 INSUFFICIENT_PERMISSION
 *   - zonder JWT: POST / en GET /:id → 401
 *
 * Patroon gekopieerd van __tests__/whatsapp/routes.test.ts: express-app met de
 * router gemount op hetzelfde pad als src/index.ts (`/api/candidates`),
 * jwt.sign met process.env.JWT_SECRET, en de dbMock-helper met een lokale
 * withRoleMatcher die de permission-middleware-queries afvangt.
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

import candidatesRouter from '../../src/modules/candidates/candidates.router';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';

/** Volledige kandidaat-rij zoals `INSERT ... RETURNING *` / `SELECT *` hem teruggeeft. */
const CANDIDATE_ROW = {
  id: CAND_ID,
  tenant_id: TENANT_ID,
  name: 'Jan de Tester',
  first_name: 'Jan',
  last_name: 'de Tester',
  email: 'jan@test.nl',
  phone: null,
  candidate_reference: 'CND-TEST-0001',
  source: 'manual',
  tags: [],
  deleted_at: null,
  created_at: '2026-07-22T10:00:00.000Z',
  updated_at: '2026-07-22T10:00:00.000Z',
};

function jwtTokenForRole(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'u@x.nl', role },
    process.env.JWT_SECRET!
  );
}

/**
 * requirePermission('candidates', 'write') bouwt vóór de handler de
 * permission-matrix op: rol uit `users`, custom rollen uit
 * `user_role_assignments`. Deze matcher vangt beide af en delegeert de rest
 * naar een optionele extra-matcher (lokaal gekopieerd uit het
 * whatsapp-routes-testpatroon).
 */
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
  // Zelfde mount-pad als src/index.ts: app.use('/api/candidates', candidatesRouter)
  app.use('/api/candidates', candidatesRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JWT gating', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST / zonder JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/candidates')
      .send({ name: 'Jan de Tester' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /:id zonder JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).get(`/api/candidates/${CAND_ID}`);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('recruiter happy path', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST / als recruiter → 201 met kandidaat', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/INSERT\s+INTO\s+candidates\b/i.test(sql)) {
          return { rows: [CANDIDATE_ROW], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+activities\b/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .post('/api/candidates')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send({ name: 'Jan de Tester', email: 'jan@test.nl' });

    expect(r.status).toBe(201);
    expect(r.body.id).toBe(CAND_ID);
    expect(r.body.name).toBe('Jan de Tester');
    expect(r.body.email).toBe('jan@test.nl');
  });

  it('GET /:id als recruiter → 200 met kandidaat + subresources', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/FROM\s+candidates\b/i.test(sql)) {
          return { rows: [CANDIDATE_ROW], rowCount: 1 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .get(`/api/candidates/${CAND_ID}`)
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`);

    expect(r.status).toBe(200);
    expect(r.body.id).toBe(CAND_ID);
    expect(r.body.name).toBe('Jan de Tester');
    // getCandidate hydrateert skills, resumes en applications (lege mocks → lege arrays)
    expect(r.body.candidate_skills).toEqual([]);
    expect(r.body.resumes).toEqual([]);
    expect(r.body.applications).toEqual([]);
  });
});

describe('permission gating — candidates:write', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST / als viewer → 403 INSUFFICIENT_PERMISSION', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('viewer') });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .post('/api/candidates')
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`)
      .send({ name: 'Jan de Tester', email: 'jan@test.nl' });

    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    expect(r.body.error.details.required).toEqual({
      resource: 'candidates',
      action: 'write',
    });
  });
});

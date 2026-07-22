/**
 * Authenticated roles routes smoke tests — systeem-audit bugklasse 3.
 *
 * Happy-path door de ECHTE HTTP-routes (adminRolesRouter, mount-pad
 * /api/admin — zie src/index.ts), inclusief requireAuth + tenantMiddleware +
 * requirePermission('users','admin'):
 *
 *   - owner:     POST /api/admin/roles → 201 (custom rol aangemaakt)
 *   - recruiter: POST /api/admin/roles → 403 INSUFFICIENT_PERMISSION
 *   - zonder JWT:                      → 401 UNAUTHORIZED
 *
 * Service-laag detailgedrag is gedekt in customRoles.service.test.ts.
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

import { adminRolesRouter } from '../../src/modules/roles/roles.router';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ROLE_ID = '44444444-4444-4444-4444-444444444444';

function jwtTokenForRole(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'u@x.nl', role },
    process.env.JWT_SECRET!
  );
}

/** requirePermission('users', 'admin') looks up the user's role
 * (+ any custom-role assignments) before the route handler runs.
 * Gekopieerd van __tests__/whatsapp/routes.test.ts (lokale helper). */
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
  // Zelfde mount-pad als src/index.ts: app.use('/api/admin', adminRolesRouter)
  app.use('/api/admin', adminRolesRouter);
  app.use(errorHandler);
  return app;
}

const CREATE_BODY = {
  key: 'campus_recruiter',
  label: 'Campus Recruiter',
  description: 'Recruitment op hogescholen',
  permissions: { candidates: { read: true, write: true } },
};

/** Rij zoals `INSERT INTO tenant_custom_roles ... RETURNING *` hem teruggeeft. */
const CREATED_ROW = {
  id: ROLE_ID,
  tenant_id: TENANT_ID,
  key: CREATE_BODY.key,
  label: CREATE_BODY.label,
  description: CREATE_BODY.description,
  permissions: CREATE_BODY.permissions,
  inherits_from: null,
  is_system: false,
  is_default: false,
  created_at: '2026-07-22T10:00:00.000Z',
  updated_at: '2026-07-22T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/roles — custom rol aanmaken', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('als owner → 201 met de aangemaakte rol', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('owner', (sql) => {
        // Pre-check op bestaande key → geen conflict (lege set).
        if (/SELECT\s+id\s+FROM\s+tenant_custom_roles/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT\s+INTO\s+tenant_custom_roles/i.test(sql)) {
          return { rows: [CREATED_ROW], rowCount: 1 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .post('/api/admin/roles')
      .set('Authorization', `Bearer ${jwtTokenForRole('owner')}`)
      .send(CREATE_BODY);

    expect(r.status).toBe(201);
    expect(r.body.data).toBeTruthy();
    expect(r.body.data.id).toBe(ROLE_ID);
    expect(r.body.data.key).toBe('campus_recruiter');
    expect(r.body.data.label).toBe('Campus Recruiter');
    expect(r.body.data.is_system).toBe(false);
    expect(r.body.data.permissions).toEqual(CREATE_BODY.permissions);
  });

  it('als recruiter → 403 INSUFFICIENT_PERMISSION', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('recruiter') });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .post('/api/admin/roles')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send(CREATE_BODY);

    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    expect(r.body.error.details.required).toEqual({
      resource: 'users',
      action: 'admin',
    });
  });

  it('zonder JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .post('/api/admin/roles')
      .send(CREATE_BODY);

    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
});

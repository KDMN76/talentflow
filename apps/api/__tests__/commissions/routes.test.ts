/**
 * Authenticated commissions routes happy-path tests — systeem-audit bugklasse 3.
 *
 * Draait door de ECHTE HTTP-routes van de module, inclusief requireAuth,
 * tenantMiddleware en requirePermission('billing', 'write'):
 *
 *   - admin:  POST /api/commissions/schemes  → 201
 *   - viewer: POST /api/commissions/schemes  → 403 INSUFFICIENT_PERMISSION
 *   - geen JWT:                              → 401
 *
 * Service-gedrag zelf is gedekt in commissions.service.test.ts.
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

import commissionsRouter from '../../src/modules/commissions/commissions.routes';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SCHEME_ID = '44444444-4444-4444-4444-444444444444';

function jwtTokenForRole(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'u@x.nl', role },
    process.env.JWT_SECRET!
  );
}

/** requirePermission('billing', 'write') looks up the user's role
 * (+ any custom-role assignments) before the route handler runs. */
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
  app.use('/api/commissions', commissionsRouter);
  app.use(errorHandler);
  return app;
}

const schemeBody = {
  name: 'Standaard fee-commissie',
  type: 'percent_of_fee',
  config: { percent: 10 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('commissions routes — auth + permission gating', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /schemes without JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/commissions/schemes')
      .send(schemeBody);
    expect(r.status).toBe(401);
  });

  it('POST /schemes as viewer → 403 INSUFFICIENT_PERMISSION', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('viewer') });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/commissions/schemes')
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`)
      .send(schemeBody);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
  });

  it('POST /schemes as admin → 201 with created scheme', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('admin', (sql) => {
        if (/INSERT\s+INTO\s+commission_schemes/i.test(sql)) {
          return {
            rows: [
              {
                id: SCHEME_ID,
                tenant_id: TENANT_ID,
                name: schemeBody.name,
                type: schemeBody.type,
                config: schemeBody.config,
                active: true,
                is_default: false,
                created_at: '2026-07-22T10:00:00.000Z',
                updated_at: '2026-07-22T10:00:00.000Z',
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
      .post('/api/commissions/schemes')
      .set('Authorization', `Bearer ${jwtTokenForRole('admin')}`)
      .send(schemeBody);
    expect(r.status).toBe(201);
    expect(r.body.data.id).toBe(SCHEME_ID);
    expect(r.body.data.name).toBe(schemeBody.name);
    expect(r.body.data.type).toBe(schemeBody.type);
    expect(r.body.data.active).toBe(true);
  });
});

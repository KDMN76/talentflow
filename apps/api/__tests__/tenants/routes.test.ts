/**
 * Authenticated tenants routes happy-path tests — systeem-audit bugklasse 3
 * ("het laatste draadje").
 *
 * Draait door de ECHTE HTTP-routes van de tenants-module, inclusief
 * requireAuth + tenantMiddleware + requireRole. Mount-pad identiek aan
 * src/index.ts: app.use('/api/tenants', tenantsRouter).
 *
 * Dekking:
 *   - owner:     PATCH /api/tenants/current → 200
 *   - recruiter: PATCH /api/tenants/current → 403
 *   - geen JWT:  PATCH /api/tenants/current → 401
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

import tenantsRouter from '../../src/modules/tenants/tenants.router';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function jwtTokenForRole(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'u@x.nl', role },
    process.env.JWT_SECRET!
  );
}

/**
 * Lokale kopie van het withRoleMatcher-patroon (zie whatsapp/routes.test.ts).
 * Vangt de rol-lookup (`FROM users`) en custom-role assignments af; extra
 * queries van de route zelf lopen via de `extra`-callback.
 *
 * NB: requireRole() in middleware/auth.ts leest de rol rechtstreeks uit de
 * JWT-payload en doet GEEN DB-lookup — de users/user_role_assignments-takken
 * blijven hier dus onaangeraakt, maar het patroon staat er conform de
 * audit-conventie zodat een toekomstige switch naar requirePermission niet
 * stilletjes op een lege mock stukloopt.
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
  app.use('/api/tenants', tenantsRouter);
  app.use(errorHandler);
  return app;
}

const TENANT_ROW = {
  id: TENANT_ID,
  name: 'Nieuwe Naam BV',
  slug: 'nieuwe-naam',
  plan: 'pro',
  settings: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/tenants/current', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('zonder JWT → 401 UNAUTHORIZED', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .patch('/api/tenants/current')
      .send({ name: 'Nieuwe Naam BV' });

    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('als owner → 200 met bijgewerkte tenant', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('owner', (sql) => {
        if (/UPDATE\s+tenants\b/i.test(sql)) {
          return { rows: [TENANT_ROW], rowCount: 1 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .patch('/api/tenants/current')
      .set('Authorization', `Bearer ${jwtTokenForRole('owner')}`)
      .send({ name: 'Nieuwe Naam BV' });

    expect(r.status).toBe(200);
    expect(r.body.id).toBe(TENANT_ID);
    expect(r.body.name).toBe('Nieuwe Naam BV');
  });

  it('als recruiter → 403 FORBIDDEN (requireRole admin/super_admin/owner)', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('recruiter') });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .patch('/api/tenants/current')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send({ name: 'Nieuwe Naam BV' });

    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });
});

/**
 * Authenticated users routes happy-path tests — systeem-audit bugklasse 3
 * ("het laatste draadje").
 *
 * Gaat door de ECHTE HTTP-routes van de users-module, inclusief requireAuth,
 * tenantMiddleware en requireRole. Service-gedrag wordt minimaal gemockt op
 * SQL-niveau via mockClient/installPoolMock.
 *
 * Router-mount komt overeen met src/index.ts: app.use('/api/users', usersRouter).
 *
 * NB: anders dan de whatsapp-module gebruikt users géén requirePermission met
 * DB-lookup — de rol komt rechtstreeks uit de JWT (requireRole). Bovendien
 * queryt deze module ZELF de users-tabel. De lokale withRoleMatcher-kopie
 * evalueert daarom eerst de `extra`-hook en pas daarna de generieke
 * `FROM users`-rolfallback, anders zou die fallback de echte data-queries
 * van de module overschrijven.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

import usersRouter from '../../src/modules/users/users.router';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333';
const NEW_USER_ID = '44444444-4444-4444-4444-444444444444';

function jwtTokenForRole(role: string, email = 'u@x.nl'): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email, role },
    process.env.JWT_SECRET!
  );
}

/**
 * Lokale kopie van het withRoleMatcher-patroon (zie whatsapp/routes.test.ts).
 * De `extra`-hook draait hier EERST: de users-module queryt zelf de
 * users-tabel, dus de generieke `FROM users` → rol-fallback mag alleen als
 * laatste redmiddel gelden.
 */
function withRoleMatcher(
  role: string,
  extra?: (sql: string) => { rows: unknown[]; rowCount: number } | undefined
) {
  return async (sql: string) => {
    const extraResult = extra?.(sql);
    if (extraResult) return extraResult;
    if (/FROM\s+user_role_assignments\b/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/FROM\s+users\b/i.test(sql)) return { rows: [{ role }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JWT gating — zonder token → 401', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /me zonder JWT → 401 UNAUTHORIZED', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).get('/api/users/me');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET / zonder JWT → 401 UNAUTHORIZED', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).get('/api/users');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /invite zonder JWT → 401 UNAUTHORIZED', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/users/invite')
      .send({ email: 'x@x.nl', name: 'X', role: 'recruiter' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('GET /me — eigen profiel', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('geauthenticeerd → 200 met eigen profiel + genest tenant-object', async () => {
    const profileRow = {
      id: USER_ID,
      email: 'admin@x.nl',
      name: 'Admin Gebruiker',
      role: 'admin',
      avatar_url: null,
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      language: null,
      tenant_default_language: 'nl',
      tenant_name: 'Acme Recruitment',
      tenant_plan: 'pro',
      tenant_settings: { timezone: 'Europe/Amsterdam' },
    };
    const client = mockClient({
      __matcher: withRoleMatcher('admin', (sql) => {
        // getMe: SELECT u.* ... FROM users u JOIN tenants t ...
        if (/JOIN\s+tenants\b/i.test(sql)) return { rows: [profileRow], rowCount: 1 };
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${jwtTokenForRole('admin', 'admin@x.nl')}`);

    expect(r.status).toBe(200);
    expect(r.body.id).toBe(USER_ID);
    expect(r.body.email).toBe('admin@x.nl');
    expect(r.body.role).toBe('admin');
    expect(r.body.tenant_default_language).toBe('nl');
    // tenant_* velden worden geconsolideerd naar een genest tenant-object
    expect(r.body.tenant).toEqual({
      id: TENANT_ID,
      name: 'Acme Recruitment',
      plan: 'pro',
      settings: { timezone: 'Europe/Amsterdam' },
    });
    expect(r.body.tenant_name).toBeUndefined();
  });
});

describe('admin routes — GET / en POST /invite', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET / als admin → 200 met lijst + meta', async () => {
    const listRows = [
      {
        id: USER_ID,
        email: 'admin@x.nl',
        name: 'Admin Gebruiker',
        role: 'admin',
        avatar_url: null,
        is_active: true,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: OTHER_USER_ID,
        email: 'recruiter@x.nl',
        name: 'Recruiter Gebruiker',
        role: 'recruiter',
        avatar_url: null,
        is_active: true,
        created_at: '2026-01-02T00:00:00.000Z',
      },
    ];
    const client = mockClient({
      __matcher: withRoleMatcher('admin', (sql) => {
        if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ total: '2' }], rowCount: 1 };
        if (/FROM\s+users\b/i.test(sql)) return { rows: listRows, rowCount: 2 };
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .get('/api/users')
      .set('Authorization', `Bearer ${jwtTokenForRole('admin', 'admin@x.nl')}`);

    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.data[0].email).toBe('admin@x.nl');
    expect(r.body.meta).toEqual({ total: 2, page: 1, limit: 20, pages: 1 });
  });

  it('POST /invite als admin → 201 met nieuwe (inactieve) user', async () => {
    const invitedRow = {
      id: NEW_USER_ID,
      email: 'nieuw@x.nl',
      name: 'Nieuwe Collega',
      role: 'recruiter',
      avatar_url: null,
      is_active: false,
      created_at: '2026-07-22T00:00:00.000Z',
    };
    const client = mockClient({
      __matcher: withRoleMatcher('admin', (sql) => {
        // 1) bestaat-al-check: SELECT id, is_active FROM users WHERE ... email
        if (/SELECT\s+id,\s*is_active\s+FROM\s+users\b/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        // 2) nieuwe user aanmaken
        if (/INSERT\s+INTO\s+users\b/i.test(sql)) {
          return { rows: [invitedRow], rowCount: 1 };
        }
        // 3) invite-token opslaan
        if (/INSERT\s+INTO\s+user_invite_tokens\b/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${jwtTokenForRole('admin', 'admin@x.nl')}`)
      .send({ email: 'nieuw@x.nl', name: 'Nieuwe Collega', role: 'recruiter' });

    expect(r.status).toBe(201);
    expect(r.body.id).toBe(NEW_USER_ID);
    expect(r.body.email).toBe('nieuw@x.nl');
    expect(r.body.is_active).toBe(false);
    // uitnodigingsmail is geënqueued (bullmq is globaal gemockt in setup.ts)
    const { emailSenderQueue } = await import('../../src/queue/queues');
    expect(emailSenderQueue.add).toHaveBeenCalledTimes(1);
  });
});

describe('permission gating — recruiter mag niet uitnodigen', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /invite als recruiter → 403 FORBIDDEN (requireRole, geen DB-hit)', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('recruiter') });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send({ email: 'nieuw@x.nl', name: 'Nieuwe Collega', role: 'recruiter' });

    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
    // requireRole blokkeert vóór de controller: er is geen enkele query gedaan
    expect(client.query).not.toHaveBeenCalled();
  });

  it('GET / als recruiter → 403 FORBIDDEN (lijst is admin-only)', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('recruiter') });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .get('/api/users')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`);

    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });
});

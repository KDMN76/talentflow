import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

import { requireAuth, enforce2faPolicy } from '../../src/middleware/auth';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function makeJwt(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'a@b.nl', role },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  );
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(requireAuth);
  app.use(enforce2faPolicy);
  app.get('/protected', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('enforce2faPolicy middleware', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('laat door wanneer geen policy', async () => {
    const client = mockClient({ __matcher: () => ({ rows: [], rowCount: 0 }) });
    teardown = installPoolMock(client);

    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${makeJwt('admin')}`);
    expect(res.status).toBe(200);
  });

  it('laat door wanneer policy aanwezig maar role niet vereist', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT tenant_id, required_for_roles/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                required_for_roles: ['admin'],
                required_for_all: false,
                grace_period_days: 0,
                created_at: new Date(0),
                updated_at: new Date(0),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${makeJwt('recruiter')}`);
    expect(res.status).toBe(200);
  });

  it('blokkeert met 428 wanneer 2FA verplicht en niet ingeschakeld', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT tenant_id, required_for_roles/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                required_for_roles: ['admin'],
                required_for_all: false,
                grace_period_days: 0,
                created_at: new Date(0), // grace ruim verlopen
                updated_at: new Date(0),
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT enabled FROM user_2fa_secrets/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${makeJwt('admin')}`);
    expect(res.status).toBe(428);
    expect(res.body.error.code).toBe('2FA_REQUIRED');
    expect(res.body.error.details.setup_url).toBe('/settings/security/2fa');
  });

  it('laat door wanneer in grace-period', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT tenant_id, required_for_roles/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                required_for_roles: ['admin'],
                required_for_all: false,
                grace_period_days: 30,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT enabled FROM user_2fa_secrets/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${makeJwt('admin')}`);
    expect(res.status).toBe(200);
  });

  it('laat door wanneer user 2FA al heeft ingeschakeld', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT tenant_id, required_for_roles/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                required_for_roles: ['admin'],
                required_for_all: true,
                grace_period_days: 0,
                created_at: new Date(0),
                updated_at: new Date(0),
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT enabled FROM user_2fa_secrets/i.test(sql)) {
          return { rows: [{ enabled: true }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${makeJwt('admin')}`);
    expect(res.status).toBe(200);
  });
});

/**
 * Zoals gemount in index.ts: enforce2faPolicy draait GLOBAAL, vóór de
 * routers en dus zonder requireAuth ervoor — de middleware decodeert de
 * Bearer-JWT zelf.
 */
function buildGlobalApp() {
  const app = express();
  app.use(express.json());
  app.use(enforce2faPolicy);
  app.get('/protected', (_req, res) => res.json({ ok: true }));
  app.get('/api/auth/2fa/status', (_req, res) => res.json({ ok: true }));
  app.get('/api/users/me', (_req, res) => res.json({ ok: true }));
  app.get('/api/users/message', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

/** Policy die 2FA voor iedereen verplicht met verlopen grace-period. */
function requiredPolicyMatcher(sql: string) {
  if (/SELECT tenant_id, required_for_roles/i.test(sql)) {
    return {
      rows: [
        {
          tenant_id: TENANT_ID,
          required_for_roles: [],
          required_for_all: true,
          grace_period_days: 0,
          created_at: new Date(0),
          updated_at: new Date(0),
        },
      ],
      rowCount: 1,
    };
  }
  if (/SELECT enabled FROM user_2fa_secrets/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
}

describe('enforce2faPolicy — globale mount (zonder requireAuth)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('decodeert de JWT zelf en blokkeert met 428 wanneer verplicht', async () => {
    const client = mockClient({ __matcher: requiredPolicyMatcher });
    teardown = installPoolMock(client);

    const res = await request(buildGlobalApp())
      .get('/protected')
      .set('Authorization', `Bearer ${makeJwt('recruiter')}`);
    expect(res.status).toBe(428);
    expect(res.body.error.code).toBe('2FA_REQUIRED');
  });

  it('laat gewhiteliste 2FA-endpoints door zodat setup mogelijk blijft', async () => {
    const client = mockClient({ __matcher: requiredPolicyMatcher });
    teardown = installPoolMock(client);

    const res = await request(buildGlobalApp())
      .get('/api/auth/2fa/status')
      .set('Authorization', `Bearer ${makeJwt('recruiter')}`);
    expect(res.status).toBe(200);
  });

  it('laat het exacte whitelist-pad /api/users/me door', async () => {
    const client = mockClient({ __matcher: requiredPolicyMatcher });
    teardown = installPoolMock(client);

    const res = await request(buildGlobalApp())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${makeJwt('recruiter')}`);
    expect(res.status).toBe(200);
  });

  it('blokkeert een prefix-bypass (/api/users/message) — geen kale startsWith', async () => {
    const client = mockClient({ __matcher: requiredPolicyMatcher });
    teardown = installPoolMock(client);

    const res = await request(buildGlobalApp())
      .get('/api/users/message')
      .set('Authorization', `Bearer ${makeJwt('recruiter')}`);
    expect(res.status).toBe(428);
    expect(res.body.error.code).toBe('2FA_REQUIRED');
  });

  it('laat requests zonder Authorization-header ongemoeid door', async () => {
    const client = mockClient({ __matcher: requiredPolicyMatcher });
    teardown = installPoolMock(client);

    const res = await request(buildGlobalApp()).get('/protected');
    expect(res.status).toBe(200);
    // Geen policy-query — er valt niets af te dwingen zonder user.
    expect(client.query).not.toHaveBeenCalled();
  });

  it('laat partial-tokens (2FA-challenge) door zonder policy-check', async () => {
    const client = mockClient({ __matcher: requiredPolicyMatcher });
    teardown = installPoolMock(client);

    const partial = jwt.sign(
      {
        userId: USER_ID,
        tenantId: TENANT_ID,
        email: 'a@b.nl',
        role: 'admin',
        aud: 'tflw:partial-2fa',
      },
      process.env.JWT_SECRET!,
      { expiresIn: '5m' }
    );

    const res = await request(buildGlobalApp())
      .get('/protected')
      .set('Authorization', `Bearer ${partial}`);
    expect(res.status).toBe(200);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('laat ongeldige JWT door — route-eigen auth handelt die af', async () => {
    const client = mockClient({ __matcher: requiredPolicyMatcher });
    teardown = installPoolMock(client);

    const res = await request(buildGlobalApp())
      .get('/protected')
      .set('Authorization', 'Bearer niet-een-jwt');
    expect(res.status).toBe(200);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('requireAuth — partial-token guard', () => {
  it('weigert partial-tokens (aud=tflw:partial-2fa) op normale routes', async () => {
    const partial = jwt.sign(
      {
        userId: USER_ID,
        tenantId: TENANT_ID,
        email: 'a@b.nl',
        role: 'admin',
        aud: 'tflw:partial-2fa',
      },
      process.env.JWT_SECRET!,
      { expiresIn: '5m' }
    );

    const app = buildApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${partial}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

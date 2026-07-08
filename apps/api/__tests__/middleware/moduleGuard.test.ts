/**
 * Tests voor de module-guard middleware (requireModule, migration 050).
 *
 * Gedragscontract:
 *   - module uit  → 403 MODULE_DISABLED met NL-melding
 *   - module aan  → next() (route antwoordt normaal)
 *   - onbekende module-key → next() (fail-open)
 *   - geen/ongeldige JWT → next() (route-eigen auth wijst af)
 *   - DB-fout in flags-lookup → next() (soft-fail, app blijft bruikbaar)
 */
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

import { requireModule } from '../../src/middleware/moduleGuard';
import { requireAuth } from '../../src/middleware/auth';
import { errorHandler } from '../../src/middleware/errorHandler';
import { MODULE_KEYS } from '../../src/modules/tenants/moduleFlags.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function makeJwt(): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'a@b.nl', role: 'recruiter' },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  );
}

/** Bouwt een app zoals index.ts: guard VÓÓR de router, requireAuth erin. */
function buildApp(moduleKey: string) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(requireAuth);
  router.get('/', (_req, res) => res.json({ ok: true }));
  app.use('/api/guarded', requireModule(moduleKey), router);
  app.use(errorHandler);
  return app;
}

/** Mock-client met een tenant_module_settings-rij (of geen rij). */
function flagsClient(modules: Record<string, boolean> | null): MockClient {
  return mockClient({
    __matcher: (sql: string) => {
      if (/FROM tenant_module_settings/i.test(sql)) {
        return modules
          ? { rows: [{ modules }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  });
}

describe('requireModule middleware', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('module uit → 403 MODULE_DISABLED met NL-melding', async () => {
    teardown = installPoolMock(flagsClient({ outreach: false }));

    const res = await request(buildApp('outreach'))
      .get('/api/guarded')
      .set('Authorization', `Bearer ${makeJwt()}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MODULE_DISABLED');
    expect(res.body.error.message).toContain('uitgeschakeld');
    expect(res.body.error.details.module).toBe('outreach');
  });

  it('module aan → request bereikt de route', async () => {
    teardown = installPoolMock(flagsClient({ outreach: true }));

    const res = await request(buildApp('outreach'))
      .get('/api/guarded')
      .set('Authorization', `Bearer ${makeJwt()}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('geen rij → defaults: gewone module aan, bevroren module uit', async () => {
    teardown = installPoolMock(flagsClient(null));

    const open = await request(buildApp('recruit_to_cash'))
      .get('/api/guarded')
      .set('Authorization', `Bearer ${makeJwt()}`);
    expect(open.status).toBe(200);

    const frozen = await request(buildApp('whatsapp'))
      .get('/api/guarded')
      .set('Authorization', `Bearer ${makeJwt()}`);
    expect(frozen.status).toBe(403);
  });

  it('onbekende module-key → fail-open (aan)', async () => {
    // Alles uit in de DB — maar de key bestaat niet, dus de guard laat door.
    const allOff = Object.fromEntries(MODULE_KEYS.map((k) => [k, false]));
    teardown = installPoolMock(flagsClient(allOff));

    const res = await request(buildApp('toekomstige_module'))
      .get('/api/guarded')
      .set('Authorization', `Bearer ${makeJwt()}`);

    expect(res.status).toBe(200);
  });

  it('geen JWT → guard laat door, route-eigen requireAuth geeft 401', async () => {
    teardown = installPoolMock(flagsClient({ outreach: false }));

    const res = await request(buildApp('outreach')).get('/api/guarded');

    // Niet 403 van de guard maar 401 van requireAuth — de guard blokkeert
    // nooit vóór authenticatie.
    expect(res.status).toBe(401);
  });

  it('DB-fout in flags-lookup → soft-fail, request gaat door', async () => {
    const failing = mockClient({
      __matcher: (sql: string) => {
        if (/FROM tenant_module_settings/i.test(sql)) {
          throw new Error('database is stuk');
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(failing);

    const res = await request(buildApp('outreach'))
      .get('/api/guarded')
      .set('Authorization', `Bearer ${makeJwt()}`);

    expect(res.status).toBe(200);
  });
});

/**
 * Contracts routes — geauthenticeerde happy-path smoke tests (systeem-audit
 * bugklasse 3: "het laatste draadje").
 *
 * Gaat door de ECHTE HTTP-routes van de contracts-module, inclusief
 * requireAuth + tenantMiddleware + requirePermission('billing','write'):
 *
 *   - admin:     POST /api/contracts → 201 (admin heeft billing:write)
 *   - recruiter: POST /api/contracts → 403 (recruiter heeft GEEN billing-key
 *                in SYSTEM_ROLES → default-deny)
 *   - geen JWT:  POST /api/contracts → 401
 *
 * Patroon overgenomen van __tests__/whatsapp/routes.test.ts. Mount-pad
 * `/api/contracts` komt uit src/index.ts (daar staat in productie óók een
 * requireModule('recruit_to_cash')-guard vóór de router; die is fail-open
 * zonder module-flags en valt buiten deze permission-test).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

import contractsRouter from '../../src/modules/contracts/contracts.routes';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';
const USER_ID = 'bbbbbbbb-2222-2222-2222-222222222222';
const CAND_ID = 'cccccccc-3333-3333-3333-333333333333';
const CONTRACT_ID = 'dddddddd-4444-4444-4444-444444444444';

function jwtTokenForRole(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'u@x.nl', role },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' }
  );
}

/**
 * requirePermission('billing', 'write') bouwt vóór de route-handler de
 * permission-matrix op: `SELECT role FROM users ...` (legacy rol) +
 * `FROM user_role_assignments ...` (custom rollen, hier altijd leeg).
 * Lokale kopie van de withRoleMatcher-helper uit whatsapp/routes.test.ts.
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
  // Zelfde mount-pad als src/index.ts (regel ~457):
  //   app.use('/api/contracts', requireModule('recruit_to_cash'), contractsRouter);
  app.use('/api/contracts', contractsRouter);
  app.use(errorHandler);
  return app;
}

/** Rij zoals `INSERT INTO contracts ... RETURNING *` die teruggeeft. */
function contractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTRACT_ID,
    tenant_id: TENANT_ID,
    candidate_id: CAND_ID,
    application_id: null,
    client_organization_id: null,
    job_id: null,
    contract_type: 'temp',
    status: 'draft',
    start_date: '2026-08-01',
    end_date: null,
    weekly_hours: null,
    hourly_rate_candidate: null,
    hourly_rate_client: null,
    margin_percent: null,
    currency: 'EUR',
    cao: null,
    wtza_compliant: null,
    metadata: {},
    signed_at: null,
    terminated_at: null,
    termination_reason: null,
    created_by: USER_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const CREATE_BODY = {
  candidate_id: CAND_ID,
  start_date: '2026-08-01',
};

describe('POST /api/contracts — auth + permission happy path', () => {
  let teardown: (() => void) | undefined;

  beforeEach(() => {
    teardown = undefined;
  });
  afterEach(() => teardown?.());

  it('zonder JWT → 401', async () => {
    const client: MockClient = mockClient({});
    teardown = installPoolMock(client);

    const res = await request(buildApp())
      .post('/api/contracts')
      .send(CREATE_BODY);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('als recruiter → 403 INSUFFICIENT_PERMISSION (billing:write vereist)', async () => {
    const client: MockClient = mockClient({
      __matcher: withRoleMatcher('recruiter'),
    });
    teardown = installPoolMock(client);

    const res = await request(buildApp())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send(CREATE_BODY);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    expect(res.body.error.details.required).toEqual({
      resource: 'billing',
      action: 'write',
    });
  });

  it('als admin → 201 met contract in { data }-envelope', async () => {
    const client: MockClient = mockClient({
      __matcher: withRoleMatcher('admin', (sql) => {
        if (/INSERT\s+INTO\s+contracts\b/i.test(sql)) {
          return { rows: [contractRow()], rowCount: 1 };
        }
        // INSERT INTO audit_events (logAudit) + BEGIN/SET/COMMIT → default ack
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const res = await request(buildApp())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${jwtTokenForRole('admin')}`)
      .send(CREATE_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(CONTRACT_ID);
    expect(res.body.data.candidate_id).toBe(CAND_ID);
    expect(res.body.data.status).toBe('draft');

    // Bewijs dat de happy path de echte INSERT raakte (niet alleen middleware).
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT\s+INTO\s+contracts\b/i.test(s))).toBe(true);
  });
});

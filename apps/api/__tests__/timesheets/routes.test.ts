import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';
import { errorHandler } from '../../src/middleware/errorHandler';
import timesheetsRouter from '../../src/modules/timesheets/timesheets.routes';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const CONTRACT_ID = '44444444-4444-4444-4444-444444444444';
const TS_ID = '55555555-5555-5555-5555-555555555555';
const CAND_ID = '66666666-6666-6666-6666-666666666666';

function token(tenantId: string, role = 'admin'): string {
  return jwt.sign(
    { userId: USER_ID, tenantId, email: 'r@example.com', role },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' }
  );
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/timesheets', timesheetsRouter);
  app.use(errorHandler);
  return app;
}

function tsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TS_ID,
    tenant_id: TENANT_A,
    contract_id: CONTRACT_ID,
    candidate_id: CAND_ID,
    week_start: '2026-05-04',
    week_end: '2026-05-10',
    status: 'draft',
    total_hours: 0,
    total_overtime_hours: 0,
    notes: null,
    submitted_at: null,
    approved_at: null,
    approved_by: null,
    rejected_at: null,
    rejection_reason: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('GET /api/timesheets', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('lists timesheets', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM timesheets/i.test(sql)) {
            return { rows: [tsRow()], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp())
      .get('/api/timesheets')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
  });

  it('rejects invalid status enum', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp())
      .get('/api/timesheets?status=foobar')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/timesheets', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('creates a timesheet', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          // requirePermission('billing','write') bouwt de matrix uit
          // users.role — de mock moet die rij leveren, net als de echte DB.
          if (/SELECT role FROM users/i.test(sql)) {
            return { rows: [{ role: 'admin' }], rowCount: 1 };
          }
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/INSERT INTO timesheets/i.test(sql)) {
            return { rows: [tsRow()], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp())
      .post('/api/timesheets')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ contract_id: CONTRACT_ID, week_start: '2026-05-04' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(TS_ID);
  });

  it('400 when week_start missing', async () => {
    // requirePermission('billing','write') draait vóór de zod-validatie;
    // zonder rol-rij zou de 403 de verwachte 400 maskeren.
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT role FROM users/i.test(sql)) {
            return { rows: [{ role: 'admin' }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp())
      .post('/api/timesheets')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ contract_id: CONTRACT_ID });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/timesheets/:id/approve — role enforcement', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('admin can approve', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          // requirePermission('billing','write') bouwt de matrix uit
          // users.role — de mock moet die rij leveren, net als de echte DB.
          if (/SELECT role FROM users/i.test(sql)) {
            return { rows: [{ role: 'admin' }], rowCount: 1 };
          }
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'submitted' })], rowCount: 1 };
          }
          if (/UPDATE timesheets/i.test(sql)) {
            return {
              rows: [tsRow({ status: 'approved' })],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp())
      .post(`/api/timesheets/${TS_ID}/approve`)
      .set('Authorization', `Bearer ${token(TENANT_A, 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });

  it('candidate is forbidden', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          // Candidate-rol heeft geen billing:write in de matrix → 403 op
          // het echte permission-pad (niet slechts door een lege mock).
          if (/SELECT role FROM users/i.test(sql)) {
            return { rows: [{ role: 'candidate' }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp())
      .post(`/api/timesheets/${TS_ID}/approve`)
      .set('Authorization', `Bearer ${token(TENANT_A, 'candidate')}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/timesheets/summary', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns billing summary', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return {
              rows: [
                {
                  id: CONTRACT_ID,
                  tenant_id: TENANT_A,
                  candidate_id: CAND_ID,
                  application_id: null,
                  client_organization_id: null,
                  job_id: null,
                  contract_type: 'temp',
                  status: 'active',
                  start_date: '2026-01-01',
                  end_date: '2026-06-30',
                  weekly_hours: 40,
                  hourly_rate_candidate: 25,
                  hourly_rate_client: 50,
                  margin_percent: 50,
                  currency: 'EUR',
                  cao: null,
                  wtza_compliant: null,
                  metadata: {},
                  signed_at: null,
                  terminated_at: null,
                  termination_reason: null,
                  created_by: null,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          if (/FROM contract_extensions/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/FROM timesheets/i.test(sql)) {
            return {
              rows: [
                {
                  id: 't-1',
                  week_start: '2026-05-04',
                  week_end: '2026-05-10',
                  total_hours: 40,
                  total_overtime_hours: 0,
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp())
      .get(
        `/api/timesheets/summary?contract_id=${CONTRACT_ID}&period_start=2026-05-01&period_end=2026-05-31`
      )
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total_hours).toBe(40);
    expect(res.body.data.total_amount_client).toBe(2000);
    expect(res.body.data.currency).toBe('EUR');
  });
});

describe('Cross-tenant isolation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('different JWT → different SET LOCAL tenant_ids', async () => {
    const observed: string[] = [];
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SET LOCAL app\.tenant_id/i.test(sql)) {
            const m = sql.match(/'([0-9a-f-]{36})'/i);
            if (m) observed.push(m[1]);
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await request(buildApp())
      .get('/api/timesheets')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    await request(buildApp())
      .get('/api/timesheets')
      .set('Authorization', `Bearer ${token(TENANT_B)}`);
    expect(observed).toContain(TENANT_A);
    expect(observed).toContain(TENANT_B);
  });
});

describe('POST /api/timesheets/portal-tokens', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('admin can issue a portal token', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          // requirePermission('billing','write') bouwt de matrix uit
          // users.role — de mock moet die rij leveren, net als de echte DB.
          if (/SELECT role FROM users/i.test(sql)) {
            return { rows: [{ role: 'admin' }], rowCount: 1 };
          }
          if (/INSERT INTO timesheet_portal_tokens/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'tok-1',
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp())
      .post('/api/timesheets/portal-tokens')
      .set('Authorization', `Bearer ${token(TENANT_A, 'admin')}`)
      .send({ contract_id: CONTRACT_ID, candidate_id: CAND_ID });
    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.expires_at).toBeTruthy();
  });

  it('candidate cannot issue a portal token', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp())
      .post('/api/timesheets/portal-tokens')
      .set('Authorization', `Bearer ${token(TENANT_A, 'candidate')}`)
      .send({ contract_id: CONTRACT_ID, candidate_id: CAND_ID });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/timesheets/:id/reject', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('rejects with reason', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          // requirePermission('billing','write') bouwt de matrix uit
          // users.role — de mock moet die rij leveren, net als de echte DB.
          if (/SELECT role FROM users/i.test(sql)) {
            return { rows: [{ role: 'admin' }], rowCount: 1 };
          }
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow({ status: 'submitted' })], rowCount: 1 };
          }
          if (/UPDATE timesheets/i.test(sql)) {
            return {
              rows: [
                tsRow({
                  status: 'rejected',
                  rejection_reason: params[0] as string,
                }),
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp())
      .post(`/api/timesheets/${TS_ID}/reject`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ reason: 'incomplete' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
    expect(res.body.data.rejection_reason).toBe('incomplete');
  });
});

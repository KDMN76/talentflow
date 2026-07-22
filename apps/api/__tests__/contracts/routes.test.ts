import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import { errorHandler } from '../../src/middleware/errorHandler';
import contractsRouter from '../../src/modules/contracts/contracts.routes';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const CAND_ID = '44444444-4444-4444-4444-444444444444';
const CONTRACT_ID = '55555555-5555-5555-5555-555555555555';

function token(tenantId: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId, email: 'r@example.com', role: 'admin' },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' }
  );
}

/** requirePermission('billing', 'write') on the mutating routes looks up the
 * user's role (+ any custom-role assignments) in the DB before the route
 * handler runs. Mirror of withRoleMatcher in __tests__/whatsapp/routes.test.ts.
 * 'billing:write' is granted to admin/owner/super_admin — tests use 'admin'. */
function withRoleMatcher(
  role: string,
  extra?: (
    sql: string,
    params: unknown[]
  ) => { rows: unknown[]; rowCount: number } | undefined
) {
  return async (sql: string, params: unknown[]) => {
    if (/FROM\s+users\b/i.test(sql)) return { rows: [{ role }], rowCount: 1 };
    if (/FROM\s+user_role_assignments\b/i.test(sql)) return { rows: [], rowCount: 0 };
    const extraResult = extra?.(sql, params);
    if (extraResult) return extraResult;
    return { rows: [], rowCount: 0 };
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/contracts', contractsRouter);
  app.use(errorHandler);
  return app;
}

function contractRow(overrides: Record<string, unknown> = {}) {
  return {
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
    created_by: USER_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('POST /api/contracts', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('creates a contract', async () => {
    const client: MockClient = mockClient({
      __matcher: withRoleMatcher('admin', (sql) => {
        if (/INSERT INTO contracts/i.test(sql)) {
          return { rows: [contractRow()], rowCount: 1 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);
    const res = await request(buildApp())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({
        candidate_id: CAND_ID,
        start_date: '2026-01-01',
        end_date: '2026-06-30',
        contract_type: 'temp',
        hourly_rate_candidate: 25,
        hourly_rate_client: 50,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(CONTRACT_ID);
  });

  it('400 when candidate_id missing', async () => {
    teardown = installPoolMock(mockClient({ __matcher: withRoleMatcher('admin') }));
    const res = await request(buildApp())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ start_date: '2026-01-01' });
    expect(res.status).toBe(400);
  });

  it('401 without JWT', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp()).post('/api/contracts').send({});
    expect(res.status).toBe(401);
  });
});

describe('GET /api/contracts/:id', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns contract with extensions list', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return { rows: [contractRow()], rowCount: 1 };
          }
          if (/FROM contract_extensions/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'ext-1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  previous_end_date: '2026-06-30',
                  new_end_date: '2026-12-31',
                  reason: null,
                  signed_at: new Date().toISOString(),
                  signed_by: USER_ID,
                  created_at: new Date().toISOString(),
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
      .get(`/api/contracts/${CONTRACT_ID}`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.extensions).toHaveLength(1);
  });

  it('returns 404 when not found', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp())
      .get(`/api/contracts/${CONTRACT_ID}`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/contracts/:id/extend', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('extends a contract', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: withRoleMatcher('admin', (sql) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return { rows: [contractRow()], rowCount: 1 };
          }
          if (/INSERT INTO contract_extensions/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'ext-1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  previous_end_date: '2026-06-30',
                  new_end_date: '2026-12-31',
                  reason: 'verlenging',
                  signed_at: new Date().toISOString(),
                  signed_by: USER_ID,
                  created_at: new Date().toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          if (/UPDATE contracts/i.test(sql)) {
            return {
              rows: [contractRow({ end_date: '2026-12-31' })],
              rowCount: 1,
            };
          }
          return undefined;
        }),
      })
    );
    const res = await request(buildApp())
      .post(`/api/contracts/${CONTRACT_ID}/extend`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ new_end_date: '2026-12-31', reason: 'verlenging' });
    expect(res.status).toBe(200);
    expect(res.body.data.contract.end_date).toBe('2026-12-31');
  });
});

describe('POST /api/contracts/:id/terminate', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('terminates and cancels notifications', async () => {
    let pendingDeleted = false;
    teardown = installPoolMock(
      mockClient({
        __matcher: withRoleMatcher('admin', (sql, params) => {
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return { rows: [contractRow()], rowCount: 1 };
          }
          if (/UPDATE contracts/i.test(sql)) {
            return {
              rows: [
                contractRow({
                  status: 'terminated',
                  termination_reason: params[0] as string,
                }),
              ],
              rowCount: 1,
            };
          }
          if (/DELETE FROM contract_notification_queue/i.test(sql)) {
            pendingDeleted = true;
            return { rows: [], rowCount: 4 };
          }
          return undefined;
        }),
      })
    );
    const res = await request(buildApp())
      .post(`/api/contracts/${CONTRACT_ID}/terminate`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ reason: 'project beëindigd' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('terminated');
    expect(pendingDeleted).toBe(true);
  });

  it('400 when reason missing', async () => {
    teardown = installPoolMock(mockClient({ __matcher: withRoleMatcher('admin') }));
    const res = await request(buildApp())
      .post(`/api/contracts/${CONTRACT_ID}/terminate`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('Cross-tenant isolation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('two different JWTs cause two different SET LOCAL tenant_ids', async () => {
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
      .get('/api/contracts')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    await request(buildApp())
      .get('/api/contracts')
      .set('Authorization', `Bearer ${token(TENANT_B)}`);

    expect(observed).toContain(TENANT_A);
    expect(observed).toContain(TENANT_B);
  });
});

describe('GET /api/contracts/:id/notifications', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('lists notification queue rows', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM contract_notification_queue/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'n1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  notification_type: 'expiring_30d',
                  scheduled_for: '2026-05-31',
                  sent_at: null,
                  recipients: [],
                  created_at: new Date().toISOString(),
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
      .get(`/api/contracts/${CONTRACT_ID}/notifications`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].notification_type).toBe('expiring_30d');
  });
});

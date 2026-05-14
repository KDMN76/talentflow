import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';
import { errorHandler } from '../../src/middleware/errorHandler';

// Stub rate-limit-redis so we don't require a real Redis backend during tests.
vi.mock('rate-limit-redis', () => ({
  RedisStore: class MockRedisStore {
    init() {}
    increment = vi.fn(async () => ({ totalHits: 1, resetTime: new Date() }));
    decrement = vi.fn(async () => undefined);
    resetKey = vi.fn(async () => undefined);
  },
}));

import publicTimesheetsRouter from '../../src/modules/timesheets/publicTimesheetRoutes';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const CONTRACT_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const TS_ID = '44444444-4444-4444-4444-444444444444';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/public/timesheets', publicTimesheetsRouter);
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

describe('Public timesheet portal — token validation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns 401 for unknown token', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp()).get(
      '/api/public/timesheets/unknown-token-xxxx'
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for expired token', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM timesheet_portal_tokens/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'tok-1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  candidate_id: CAND_ID,
                  expires_at: new Date(Date.now() - 86400000).toISOString(),
                  revoked_at: null,
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp()).get(
      '/api/public/timesheets/expired-token'
    );
    expect(res.status).toBe(401);
  });
});

describe('Public timesheet portal — happy path', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET returns the active week timesheet for a valid token', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM timesheet_portal_tokens/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'tok-1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  candidate_id: CAND_ID,
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  revoked_at: null,
                },
              ],
              rowCount: 1,
            };
          }
          if (/UPDATE timesheet_portal_tokens/i.test(sql)) {
            return { rows: [], rowCount: 1 };
          }
          if (/FROM timesheets/i.test(sql) && /SELECT \*/i.test(sql)) {
            return { rows: [tsRow()], rowCount: 1 };
          }
          if (/FROM timesheet_entries/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp())
      .get('/api/public/timesheets/some-valid-token-xxxxxxxxxxxxxxxxxxxxxx?week_start=2026-05-04');
    expect(res.status).toBe(200);
    expect(res.body.data.contract_id).toBe(CONTRACT_ID);
    expect(res.body.data.timesheet.id).toBe(TS_ID);
    expect(res.body.data.token_expires_at).toBeTruthy();
  });

  it('POST /entries adds an entry through the portal', async () => {
    let inserted = false;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/FROM timesheet_portal_tokens/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'tok-1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  candidate_id: CAND_ID,
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  revoked_at: null,
                },
              ],
              rowCount: 1,
            };
          }
          if (/UPDATE timesheet_portal_tokens/i.test(sql)) {
            return { rows: [], rowCount: 1 };
          }
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow()], rowCount: 1 };
          }
          if (/SELECT \* FROM timesheet_entries/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/INSERT INTO timesheet_entries/i.test(sql)) {
            inserted = true;
            return {
              rows: [
                {
                  id: 'e-1',
                  tenant_id: TENANT_A,
                  timesheet_id: TS_ID,
                  date: params[2],
                  hours: params[3],
                  overtime_hours: 0,
                  break_minutes: 0,
                  description: null,
                  project_code: null,
                  created_at: new Date().toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          if (/SUM\(hours\)/i.test(sql)) {
            return {
              rows: [{ total_hours: 8, total_overtime_hours: 0 }],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp())
      .post('/api/public/timesheets/some-valid-token-xxxxxxxxxxxxxxxxxxxxxx/entries')
      .send({ date: '2026-05-05', hours: 8 });
    expect(res.status).toBe(201);
    expect(inserted).toBe(true);
    expect(res.body.data.totals.total_hours).toBe(8);
  });

  it('POST /submit transitions draft → submitted', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM timesheet_portal_tokens/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'tok-1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  candidate_id: CAND_ID,
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  revoked_at: null,
                },
              ],
              rowCount: 1,
            };
          }
          if (/UPDATE timesheet_portal_tokens/i.test(sql)) {
            return { rows: [], rowCount: 1 };
          }
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow()], rowCount: 1 };
          }
          if (/UPDATE timesheets/i.test(sql) && /status = 'submitted'/i.test(sql)) {
            return {
              rows: [
                tsRow({
                  status: 'submitted',
                  submitted_at: new Date().toISOString(),
                }),
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp()).post(
      '/api/public/timesheets/some-valid-token-xxxxxxxxxxxxxxxxxxxxxx/submit?week_start=2026-05-04'
    );
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('submitted');
  });
});

describe('Cross-tenant safety', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('a token from tenant A is automatically scoped to that tenant on entry insert', async () => {
    const observedTenant: string[] = [];
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SET LOCAL app\.tenant_id/i.test(sql)) {
            const m = sql.match(/'([0-9a-f-]{36})'/i);
            if (m) observedTenant.push(m[1]);
            return { rows: [], rowCount: 0 };
          }
          if (/FROM timesheet_portal_tokens/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'tok-1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  candidate_id: CAND_ID,
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  revoked_at: null,
                },
              ],
              rowCount: 1,
            };
          }
          if (/UPDATE timesheet_portal_tokens/i.test(sql)) {
            return { rows: [], rowCount: 1 };
          }
          if (/SELECT \* FROM timesheets/i.test(sql)) {
            return { rows: [tsRow()], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await request(buildApp()).get(
      '/api/public/timesheets/some-valid-token-xxxxxxxxxxxxxxxxxxxxxx'
    );
    expect(observedTenant).toContain(TENANT_A);
  });
});

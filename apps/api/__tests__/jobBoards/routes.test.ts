import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import { errorHandler } from '../../src/middleware/errorHandler';

// Mock the queues so route handlers can enqueue without Redis.
// vi.hoisted() lets us share state between the mock factory (hoisted) and
// the test body (not hoisted) without "Cannot access before init" errors.
const { queueAddSpy } = vi.hoisted(() => ({
  queueAddSpy: vi.fn(async () => ({ id: 'mock-job' })),
}));
vi.mock('../../src/queue/queues', () => ({
  jobBoardPostQueue: { add: queueAddSpy },
  jobBoardPollQueue: { add: vi.fn(async () => ({ id: 'mock-job' })) },
}));

import jobBoardsRouter from '../../src/modules/job-boards/routes';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const JOB_ID = '44444444-4444-4444-4444-444444444444';
const POSTING_ID = '55555555-5555-5555-5555-555555555555';

function token(tenantId: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId, email: 'a@b.nl', role: 'admin' },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' }
  );
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/job-boards', jobBoardsRouter);
  app.use(errorHandler);
  return app;
}

describe('GET /api/job-boards/catalog', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('lists boards with connected=false when no integrations', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp())
      .get('/api/job-boards/catalog')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const li = res.body.data.find(
      (c: { id: string }) => c.id === 'linkedin'
    );
    expect(li).toBeDefined();
    expect(li.connected).toBe(false);
  });

  it('returns 401 without JWT', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp()).get('/api/job-boards/catalog');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/job-boards/integrations/:boardId/connect', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('connects + records audit event', async () => {
    let auditAction: string | null = null;
    const client: MockClient = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO job_board_integrations/i.test(sql)) {
          return {
            rows: [
              {
                id: 'integ-1',
                tenant_id: params[0],
                board_id: params[1],
                display_name: params[2],
                status: 'connected',
                settings: {},
                connected_by: params[5],
                connected_at: new Date().toISOString(),
                last_polled_at: null,
                last_error: null,
                created_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          auditAction = params[2] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const res = await request(buildApp())
      .post('/api/job-boards/integrations/linkedin/connect')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({
        credentials: { access_token: 'real-token-xxxxxxxxx' },
        display_name: 'LinkedIn',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.board_id).toBe('linkedin');
    expect(auditAction).toBe('job_board.integration.connected');
  });

  it('returns 400 for unknown board', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp())
      .post('/api/job-boards/integrations/no-such-board/connect')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ credentials: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_BOARD');
  });
});

describe('POST /api/job-boards/postings', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('enqueues postings for each board id', async () => {
    queueAddSpy.mockClear();
    let postingsCreated = 0;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT id FROM job_board_integrations/i.test(sql)) {
            return { rows: [{ id: 'integ-1' }], rowCount: 1 };
          }
          if (/SELECT id FROM jobs/i.test(sql)) {
            return { rows: [{ id: JOB_ID }], rowCount: 1 };
          }
          if (/INSERT INTO job_postings/i.test(sql)) {
            postingsCreated++;
            return {
              rows: [
                {
                  id: `post-${postingsCreated}`,
                  tenant_id: TENANT_A,
                  job_id: JOB_ID,
                  board_id: 'linkedin',
                  integration_id: 'integ-1',
                  status: 'queued',
                  applicants_count: 0,
                  cost_currency: 'EUR',
                  metadata: {},
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
      .post('/api/job-boards/postings')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ job_id: JOB_ID, board_ids: ['linkedin', 'indeed'] });

    expect(res.status).toBe(201);
    expect(res.body.data.length).toBe(2);
    expect(queueAddSpy).toHaveBeenCalledTimes(2);
  });

  it('400 on invalid body (missing job_id)', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp())
      .post('/api/job-boards/postings')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ board_ids: ['linkedin'] });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/job-boards/postings/:id (retract)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('retracts the posting + writes audit', async () => {
    const events: string[] = [];
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM job_postings/i.test(sql)) {
            return {
              rows: [
                {
                  id: POSTING_ID,
                  tenant_id: TENANT_A,
                  job_id: JOB_ID,
                  board_id: 'linkedin',
                  integration_id: 'integ-1',
                  external_id: 'li-x',
                  status: 'posted',
                  applicants_count: 0,
                  cost_currency: 'EUR',
                  metadata: {},
                  created_at: new Date().toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          if (/SELECT id, tenant_id, settings, credentials_encrypted/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'integ-1',
                  tenant_id: TENANT_A,
                  settings: {},
                  credentials_encrypted: null,
                },
              ],
              rowCount: 1,
            };
          }
          if (/UPDATE job_postings\b[^]*status = 'retracted'/i.test(sql)) {
            events.push('updated');
            return { rows: [], rowCount: 1 };
          }
          if (/INSERT INTO job_posting_status_events/i.test(sql)) {
            events.push('event');
            return { rows: [], rowCount: 1 };
          }
          if (/INSERT INTO audit_events/i.test(sql)) {
            events.push('audit');
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );

    process.env.JOB_BOARDS_MOCK = 'true';
    const res = await request(buildApp())
      .delete(`/api/job-boards/postings/${POSTING_ID}`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    delete process.env.JOB_BOARDS_MOCK;

    expect(res.status).toBe(204);
    expect(events).toContain('updated');
    expect(events).toContain('event');
    expect(events).toContain('audit');
  });
});

describe('Cross-tenant isolation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('two different JWTs cause two different tenant SET LOCALs', async () => {
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
      .get('/api/job-boards/integrations')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    await request(buildApp())
      .get('/api/job-boards/integrations')
      .set('Authorization', `Bearer ${token(TENANT_B)}`);

    expect(observed).toContain(TENANT_A);
    expect(observed).toContain(TENANT_B);
  });
});

describe('GET /api/job-boards/postings query validation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('rejects invalid status enum value', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp())
      .get('/api/job-boards/postings?status=published')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(400);
  });

  it('accepts queued|posted|... and returns 200', async () => {
    teardown = installPoolMock(mockClient({ job_postings: [] }));
    const res = await request(buildApp())
      .get('/api/job-boards/postings?status=posted')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/job-boards/cost-per-hire', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns rows for the tenant', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM cost_per_hire_records/i.test(sql)) {
            return {
              rows: [
                {
                  job_id: JOB_ID,
                  application_id: 'app-1',
                  posting_id: POSTING_ID,
                  source_board_id: 'linkedin',
                  attributed_cost: 49,
                  currency: 'EUR',
                  computed_at: new Date().toISOString(),
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
      .get(`/api/job-boards/cost-per-hire?job_id=${JOB_ID}`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].source_board_id).toBe('linkedin');
  });
});

describe('GET /api/job-boards/postings/:id', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns 404 for unknown id', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM job_postings/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const res = await request(buildApp())
      .get(`/api/job-boards/postings/${POSTING_ID}`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(404);
  });

  it('returns posting + events', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM job_postings/i.test(sql)) {
            return {
              rows: [
                {
                  id: POSTING_ID,
                  tenant_id: TENANT_A,
                  job_id: JOB_ID,
                  board_id: 'linkedin',
                  status: 'posted',
                  applicants_count: 3,
                  cost_currency: 'EUR',
                  metadata: {},
                  created_at: new Date().toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          if (/FROM job_posting_status_events/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'evt-1',
                  event: 'queued',
                  payload: {},
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
      .get(`/api/job-boards/postings/${POSTING_ID}`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    expect(res.body.posting.id).toBe(POSTING_ID);
    expect(res.body.events.length).toBe(1);
  });
});

/**
 * Outreach + Nurture HTTP route smoke tests — Sprint Q4.5 (Agent XXX).
 *
 * Validates auth requirement + happy-path validation. Service-layer logic is
 * already covered in outreach.service.test / nurture.service.test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

vi.mock('../../src/lib/aiEvents', () => ({
  logAIEvent: vi.fn(async () => undefined),
}));

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import outreachRouter from '../../src/modules/outreach/outreach.routes';
import nurtureRouter from '../../src/modules/nurture/nurture.routes';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const SEQ_ID = '44444444-4444-4444-4444-444444444444';

function jwtToken(): string {
  return jwt.sign(
    {
      userId: USER_ID,
      tenantId: TENANT_ID,
      email: 'r@x.nl',
      role: 'recruiter',
    },
    process.env.JWT_SECRET!
  );
}

/** requirePermission('communications', 'write') looks up the user's role
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
  app.use('/api/outreach', outreachRouter);
  app.use('/api/nurture', nurtureRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MOCK = 'true';
});

afterEach(() => {
  delete process.env.AI_MOCK;
});

describe('auth gating', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /api/outreach/messages without JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app).get('/api/outreach/messages');
    expect(r.status).toBe(401);
  });

  it('GET /api/nurture/sequences without JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app).get('/api/nurture/sequences');
    expect(r.status).toBe(401);
  });
});

describe('outreach happy paths', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /api/outreach/messages returns paged result', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+outreach_messages/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .get('/api/outreach/messages')
      .set('authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('POST /api/outreach/messages/draft returns 201 with mocked draft', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/FROM\s+candidates/i.test(sql)) {
          return {
            rows: [
              {
                id: CAND_ID,
                name: 'Test',
                first_name: 'Test',
                last_name: '',
                email: 't@e.nl',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+outreach_messages/i.test(sql)) {
          return {
            rows: [
              {
                id: 'm1',
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                channel: 'email',
                direction: 'outbound',
                status: 'pending_approval',
                created_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post('/api/outreach/messages/draft')
      .set('authorization', `Bearer ${jwtToken()}`)
      .send({
        candidate_id: CAND_ID,
        channel: 'email',
        signals: { brief_role: 'Eng' },
      });
    expect(r.status).toBe(201);
    expect(r.body.mocked).toBe(true);
  });

  it('POST /api/outreach/messages/draft validates body via zod (400)', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('recruiter') });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post('/api/outreach/messages/draft')
      .set('authorization', `Bearer ${jwtToken()}`)
      .send({ candidate_id: 'not-a-uuid' });
    expect(r.status).toBe(400);
  });
});

describe('nurture happy paths', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /api/nurture/sequences creates a sequence', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/INSERT\s+INTO\s+nurture_sequences/i.test(sql)) {
          return {
            rows: [
              {
                id: SEQ_ID,
                tenant_id: TENANT_ID,
                name: 'Outbound',
                description: null,
                active: true,
                total_steps: 0,
                metadata: {},
                created_by: USER_ID,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post('/api/nurture/sequences')
      .set('authorization', `Bearer ${jwtToken()}`)
      .send({ name: 'Outbound' });
    expect(r.status).toBe(201);
    expect(r.body.data.name).toBe('Outbound');
  });

  it('POST /api/nurture/sequences with bad body → 400', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('recruiter') });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post('/api/nurture/sequences')
      .set('authorization', `Bearer ${jwtToken()}`)
      .send({ name: '' });
    expect(r.status).toBe(400);
  });

  it('POST /api/nurture/sequences/:id/steps adds a step', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/SELECT\s+id\s+FROM\s+nurture_sequences/i.test(sql)) {
          return { rows: [{ id: SEQ_ID }], rowCount: 1 };
        }
        if (/MAX\(step_order\)/i.test(sql)) {
          return { rows: [{ max: null }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+nurture_steps/i.test(sql)) {
          return {
            rows: [
              {
                id: 'step-1',
                tenant_id: TENANT_ID,
                sequence_id: SEQ_ID,
                step_order: 1,
                channel: 'email',
                delay_days: 0,
                ai_personalize: true,
                template_subject: null,
                template_body: null,
                stop_on_reply: true,
                metadata: {},
                created_at: '',
              },
            ],
            rowCount: 1,
          };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post(`/api/nurture/sequences/${SEQ_ID}/steps`)
      .set('authorization', `Bearer ${jwtToken()}`)
      .send({ channel: 'email', delay_days: 0 });
    expect(r.status).toBe(201);
  });
});

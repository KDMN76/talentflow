/**
 * inbox HTTP route smoke tests — Sprint Q4.6 (Agent AAAA).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import inboxRouter from '../../src/modules/inbox/inbox.routes';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_OTHER = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const THREAD_ID = '44444444-4444-4444-4444-444444444444';

function jwtToken(tenant: string = TENANT_ID): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: tenant, email: 'r@x.nl', role: 'recruiter' },
    process.env.JWT_SECRET!
  );
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/inbox', inboxRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => vi.clearAllMocks());

/** requirePermission('communications', 'write') looks up the user's role
 * (+ any custom-role assignments) before the route handler runs.
 * Mirrors withRoleMatcher in __tests__/whatsapp/routes.test.ts. */
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

function buildThread(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: THREAD_ID,
    tenant_id: TENANT_ID,
    candidate_id: CAND_ID,
    last_message_at: '2026-05-01T10:00:00Z',
    last_channel: 'email',
    last_message_preview: 'hi',
    unread_count_for_assignee: 1,
    assignee_user_id: null,
    pinned: false,
    archived_at: null,
    labels: [],
    metadata: {},
    created_at: '2026-05-01T10:00:00Z',
    updated_at: '2026-05-01T10:00:00Z',
    candidate_name: 'Test',
    ...overrides,
  };
}

describe('auth', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /threads without JWT returns 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app).get('/api/inbox/threads');
    expect(r.status).toBe(401);
  });
});

describe('GET /api/inbox/threads', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns paginated threads', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [buildThread()], rowCount: 1 }),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .get('/api/inbox/threads')
      .set('authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(1);
  });
});

describe('GET /api/inbox/threads/:id/timeline', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns merged timeline events', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+unified_threads/i.test(sql)) {
          return { rows: [{ candidate_id: CAND_ID }], rowCount: 1 };
        }
        if (/FROM\s+communications/i.test(sql)) {
          return {
            rows: [
              {
                id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                channel: 'email',
                direction: 'outbound',
                sent_at: '2026-05-01T10:00:00Z',
                created_at: '2026-05-01T10:00:00Z',
                subject: 'Hi',
                body: 'Body',
                preview: 'Body',
                message_id: null,
                thread_id: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const app = buildApp();
    const r = await request(app)
      .get(`/api/inbox/threads/${THREAD_ID}/timeline`)
      .set('authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
  });
});

describe('mutation routes', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /threads/:id/read marks read', async () => {
    const client = mockClient({
      __matcher: async () => ({
        rows: [buildThread({ unread_count_for_assignee: 0 })],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post(`/api/inbox/threads/${THREAD_ID}/read`)
      .set('authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data.unread_count_for_assignee).toBe(0);
  });

  it('POST /threads/:id/pin returns pinned=true', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', () => ({
        rows: [buildThread({ pinned: true })],
        rowCount: 1,
      })),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post(`/api/inbox/threads/${THREAD_ID}/pin`)
      .set('authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data.pinned).toBe(true);
  });

  it('POST /threads/:id/archive returns archived_at', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', () => ({
        rows: [buildThread({ archived_at: '2026-05-01T12:00:00Z' })],
        rowCount: 1,
      })),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post(`/api/inbox/threads/${THREAD_ID}/archive`)
      .set('authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data.archived_at).not.toBeNull();
  });

  it('POST /threads/:id/assign updates assignee', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', () => ({
        rows: [buildThread({ assignee_user_id: USER_ID })],
        rowCount: 1,
      })),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post(`/api/inbox/threads/${THREAD_ID}/assign`)
      .set('authorization', `Bearer ${jwtToken()}`)
      .send({ user_id: USER_ID });
    expect(r.status).toBe(200);
    expect(r.body.data.assignee_user_id).toBe(USER_ID);
  });

  it('POST /threads/:id/labels adds label', async () => {
    const base = buildThread({ labels: [] });
    let phase = 0;
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/^SELECT\s+\*\s+FROM\s+unified_threads/i.test(sql)) {
          return { rows: [base], rowCount: 1 };
        }
        if (/UPDATE\s+unified_threads/i.test(sql)) {
          phase++;
          return {
            rows: [{ ...base, labels: ['urgent'] }],
            rowCount: 1,
          };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post(`/api/inbox/threads/${THREAD_ID}/labels`)
      .set('authorization', `Bearer ${jwtToken()}`)
      .send({ label: 'urgent' });
    expect(r.status).toBe(200);
    expect(r.body.data.labels).toContain('urgent');
    expect(phase).toBeGreaterThan(0);
  });
});

describe('cross-tenant isolation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('a JWT for TENANT_OTHER cannot access TENANT_ID rows', async () => {
    let calledTenant: string | null = null;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/FROM\s+unified_threads/i.test(sql)) {
          calledTenant = (params as unknown[])[0] as string;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    await request(app)
      .get('/api/inbox/threads')
      .set('authorization', `Bearer ${jwtToken(TENANT_OTHER)}`);
    expect(calledTenant).toBe(TENANT_OTHER);
  });
});

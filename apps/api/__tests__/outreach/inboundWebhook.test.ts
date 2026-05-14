/**
 * Outreach inbound webhook tests — Sprint Q4.5 (Agent XXX).
 *
 * Verifies HMAC signature handling + the happy-path of recording a reply
 * via supertest against the Express router.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';
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

import inboundWebhookRouter from '../../src/modules/outreach/inboundWebhook.routes';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const SECRET = 'test-secret-' + 'x'.repeat(40);

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', inboundWebhookRouter);
  app.use((err: Error & { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode ?? 500).json({
      error: { code: err.code ?? 'INTERNAL', message: err.message },
    });
  });
  return app;
}

function sign(body: object): string {
  return crypto.createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex');
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MOCK = 'true';
  process.env.OUTREACH_REPLY_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.AI_MOCK;
  delete process.env.OUTREACH_REPLY_WEBHOOK_SECRET;
});

describe('POST /api/webhooks/outreach/replies', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns 401 when signature is missing', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const app = buildApp();
    const body = {
      tenant_id: TENANT_ID,
      channel: 'email',
      external_thread_id: 'thread-1',
      reply_text: 'hello',
    };
    const res = await request(app)
      .post('/api/webhooks/outreach/replies')
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('returns 401 when signature does not match', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const app = buildApp();
    const body = {
      tenant_id: TENANT_ID,
      channel: 'email',
      external_thread_id: 'thread-1',
      reply_text: 'hello',
    };
    const res = await request(app)
      .post('/api/webhooks/outreach/replies')
      .set('x-outreach-signature', 'v1=deadbeef')
      .send(body);
    expect(res.status).toBe(401);
  });

  it('records reply with valid signature', async () => {
    const parent = {
      id: 'parent-x',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      direction: 'outbound',
      channel: 'email',
      external_thread_id: 'thread-1',
      enrollment_id: null,
    };
    const newReply = {
      id: 'reply-x',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      direction: 'inbound',
      channel: 'email',
      body_text: 'hello back',
      external_thread_id: 'thread-1',
      created_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/external_thread_id\s*=\s*\$2\s+AND\s+direction\s*=\s*'outbound'/is.test(sql)) {
          return { rows: [parent], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+outreach_messages.*'inbound'/is.test(sql)) {
          return { rows: [newReply], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();

    const body = {
      tenant_id: TENANT_ID,
      channel: 'email',
      external_thread_id: 'thread-1',
      reply_text: 'hello back',
    };
    const sig = `v1=${sign(body)}`;
    const res = await request(app)
      .post('/api/webhooks/outreach/replies')
      .set('x-outreach-signature', sig)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('recorded');
  });

  it('rejects malformed body with 400', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const app = buildApp();

    const body = { foo: 'bar' };
    const sig = `v1=${sign(body)}`;
    const res = await request(app)
      .post('/api/webhooks/outreach/replies')
      .set('x-outreach-signature', sig)
      .send(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

/**
 * Authenticated WhatsApp routes smoke tests — Sprint Q4.6 (Agent ZZZ).
 *
 * Verifies JWT gating + Zod validation. Service-layer behaviour is covered
 * by dedicated service tests.
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

import whatsappRouter from '../../src/modules/whatsapp/whatsapp.routes';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';

function jwtToken(): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'r@x.nl', role: 'recruiter' },
    process.env.JWT_SECRET!
  );
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/whatsapp', whatsappRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JWT gating', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /integration without JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).get('/api/whatsapp/integration');
    expect(r.status).toBe(401);
  });

  it('GET /templates without JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).get('/api/whatsapp/templates');
    expect(r.status).toBe(401);
  });

  it('GET /messages without JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).get('/api/whatsapp/messages');
    expect(r.status).toBe(401);
  });
});

describe('integration routes', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /integration returns null when not configured', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .get('/api/whatsapp/integration')
      .set('Authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toBeNull();
  });

  it('POST /integration/connect validates E.164', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/whatsapp/integration/connect')
      .set('Authorization', `Bearer ${jwtToken()}`)
      .send({ phone_number: '0612345678', api_key: 'aaaaaaaa' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe('templates routes', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /templates returns empty data array', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .get('/api/whatsapp/templates')
      .set('Authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it('POST /templates rejects missing body', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/whatsapp/templates')
      .set('Authorization', `Bearer ${jwtToken()}`)
      .send({});
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe('consent routes', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /consents returns paged list', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .get('/api/whatsapp/consents')
      .set('Authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(r.body.next_cursor).toBeNull();
  });

  it('POST /consents/invite returns token_url + expires_at', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+whatsapp_consents/i.test(sql)) return { rows: [], rowCount: 1 };
        if (/INSERT\s+INTO\s+whatsapp_optin_tokens/i.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/whatsapp/consents/invite')
      .set('Authorization', `Bearer ${jwtToken()}`)
      .send({ candidate_id: CAND_ID, phone_number: '+31612345678' });
    expect(r.status).toBe(201);
    expect(r.body.data.token_url).toContain('/whatsapp/opt-in/');
    expect(r.body.data.expires_at).toBeTruthy();
  });
});

describe('messages route — consent gate', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /messages without consent → 403', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_consents/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/whatsapp/messages')
      .set('Authorization', `Bearer ${jwtToken()}`)
      .send({ candidate_id: CAND_ID, kind: 'text', body: 'hi' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('WHATSAPP_CONSENT_MISSING');
  });
});

describe('openapi registration', () => {
  it('whatsapp routes appear in OpenAPI doc', async () => {
    const { getOpenApiSpec, resetOpenApiCache } = await import('../../src/lib/openapi');
    resetOpenApiCache();
    const spec = getOpenApiSpec() as { paths?: Record<string, unknown>; tags?: Array<{ name: string }> };
    expect(spec.paths).toBeTruthy();
    expect(spec.paths!['/api/whatsapp/integration']).toBeTruthy();
    expect(spec.paths!['/api/whatsapp/messages']).toBeTruthy();
    expect(spec.paths!['/api/whatsapp/templates']).toBeTruthy();
    expect(spec.paths!['/api/public/whatsapp/opt-in/{token}']).toBeTruthy();
    expect(spec.paths!['/api/webhooks/whatsapp/{tenantSlug}']).toBeTruthy();
  });
});

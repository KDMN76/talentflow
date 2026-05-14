/**
 * voice HTTP route smoke tests — Sprint Q4.6 (Agent AAAA).
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

import voiceRouter from '../../src/modules/voice/voice.routes';
import { errorHandler } from '../../src/middleware/errorHandler';
import { encrypt } from '../../src/lib/encryption';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_OTHER = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const CALL_ID = '66666666-6666-6666-6666-666666666666';
const INT_ID = '77777777-7777-7777-7777-777777777777';

function jwtToken(tenant: string = TENANT_ID): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: tenant, email: 'r@x.nl', role: 'recruiter' },
    process.env.JWT_SECRET!
  );
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/voice', voiceRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => vi.clearAllMocks());

function integrationRow(): Record<string, unknown> {
  return {
    id: INT_ID,
    tenant_id: TENANT_ID,
    provider: 'twilio',
    status: 'connected',
    account_sid: 'ACtest',
    phone_number: '+311234567',
    auth_token_encrypted: encrypt('secret'),
    webhook_secret_encrypted: encrypt('w-secret'),
    connected_by: USER_ID,
    connected_at: '2026-05-01T10:00:00Z',
    last_error: null,
    metadata: {},
    created_at: '2026-05-01T10:00:00Z',
  };
}

function callRow(): Record<string, unknown> {
  return {
    id: CALL_ID,
    tenant_id: TENANT_ID,
    integration_id: INT_ID,
    candidate_id: CAND_ID,
    direction: 'outbound',
    status: 'queued',
    from_number: '+311234567',
    to_number: '+316123456',
    external_sid: 'twilio-mock-abc',
    duration_seconds: 0,
    recording_url: null,
    recording_duration_seconds: null,
    transcription_text: null,
    transcription_status: null,
    voicemail: false,
    notes: null,
    initiated_by: USER_ID,
    started_at: '2026-05-01T10:00:00Z',
    answered_at: null,
    ended_at: null,
    communication_id: null,
    metadata: {},
    created_at: '2026-05-01T10:00:00Z',
  };
}

describe('auth', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /integration without JWT returns 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app).get('/api/voice/integration');
    expect(r.status).toBe(401);
  });
});

describe('GET /api/voice/integration', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns null when no integration', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .get('/api/voice/integration')
      .set('authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toBeNull();
  });

  it('returns the integration when present', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+voice_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .get('/api/voice/integration')
      .set('authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe(INT_ID);
  });
});

describe('POST /api/voice/integration/connect', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns 201 on success (mock-mode)', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+voice_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post('/api/voice/integration/connect')
      .set('authorization', `Bearer ${jwtToken()}`)
      .send({
        account_sid: 'ACtest123',
        auth_token: 'auth-secret',
        phone_number: '+311234567',
      });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('connected');
  });

  it('returns 400 on invalid body', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post('/api/voice/integration/connect')
      .set('authorization', `Bearer ${jwtToken()}`)
      .send({ account_sid: 'short' });
    expect(r.status).toBe(400);
  });
});

describe('GET /api/voice/calls + /api/voice/calls/:id', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /calls returns list', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+voice_calls/i.test(sql)) {
          return { rows: [callRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .get('/api/voice/calls')
      .set('authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(1);
  });

  it('GET /calls/:id returns single', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+voice_calls/i.test(sql)) {
          return { rows: [callRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .get(`/api/voice/calls/${CALL_ID}`)
      .set('authorization', `Bearer ${jwtToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe(CALL_ID);
  });
});

describe('POST /api/voice/calls (initiate)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns 201 with mock call', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+voice_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        if (/FROM\s+candidates/i.test(sql)) {
          return { rows: [{ phone: '+316123456' }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+voice_calls/i.test(sql)) {
          return { rows: [callRow()], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+communications/i.test(sql)) {
          return { rows: [{ id: 'comm-uuid' }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+unified_threads/i.test(sql)) {
          return { rows: [{ id: 'thread-uuid' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post('/api/voice/calls')
      .set('authorization', `Bearer ${jwtToken()}`)
      .send({ candidate_id: CAND_ID });
    expect(r.status).toBe(201);
    expect(r.body.data.external_sid).toContain('twilio-mock-');
  });
});

describe('POST /api/voice/calls/:id/notes', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('appends notes', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+voice_calls/i.test(sql)) {
          return {
            rows: [{ ...callRow(), notes: 'Recruiter says go ahead' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post(`/api/voice/calls/${CALL_ID}/notes`)
      .set('authorization', `Bearer ${jwtToken()}`)
      .send({ notes: 'Recruiter says go ahead' });
    expect(r.status).toBe(200);
    expect(r.body.data.notes).toContain('go ahead');
  });
});

describe('cross-tenant isolation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('voice integration query uses JWT-tenant', async () => {
    let firstParam: unknown = null;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/FROM\s+voice_integrations/i.test(sql)) {
          firstParam = (params as unknown[])[0];
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    await request(app)
      .get('/api/voice/integration')
      .set('authorization', `Bearer ${jwtToken(TENANT_OTHER)}`);
    expect(firstParam).toBe(TENANT_OTHER);
  });
});

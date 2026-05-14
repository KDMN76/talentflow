/**
 * 360dialog inbound webhook tests — Sprint Q4.6 (Agent ZZZ).
 *
 * Verifies HMAC signature handling, inbound message persistence, status
 * callback handling, idempotency, opt-in / STOP keyword detection, and
 * cross-tenant isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import webhookRouter from '../../src/modules/whatsapp/webhookRoutes';
import { encrypt } from '../../src/lib/encryption';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const SECRET = 'whatsapp-test-secret-' + 'x'.repeat(40);

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', webhookRouter);
  app.use(
    (
      err: Error & { statusCode?: number; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(err.statusCode ?? 500).json({
        error: { code: err.code ?? 'INTERNAL', message: err.message },
      });
    }
  );
  return app;
}

function sign(body: object, secret = SECRET): string {
  const raw = JSON.stringify(body);
  return `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
}

function inboundPayload(externalId: string, body: string): object {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: externalId,
                  from: '31612345678',
                  type: 'text',
                  text: { body },
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function statusPayload(externalId: string, status: 'delivered' | 'read' | 'failed'): object {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                {
                  id: externalId,
                  status,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

// Ensure encryption key is fixed so encrypt() in tests is deterministic and
// production-mode (used to force webhook-secret enforcement) does not throw.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'a'.repeat(64);

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.NODE_ENV = 'production'; // force webhook-secret enforcement
  // Reset the encryption-key cache so the production env-var path is used.
  const { _resetEncryptionKeyCacheForTests } = await import('../../src/lib/encryption');
  _resetEncryptionKeyCacheForTests();
});

afterEach(async () => {
  process.env.NODE_ENV = 'test';
  const { _resetEncryptionKeyCacheForTests } = await import('../../src/lib/encryption');
  _resetEncryptionKeyCacheForTests();
});

describe('POST /api/webhooks/whatsapp/:tenantSlug — signature handling', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns 404 for unknown tenant slug', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app)
      .post('/api/webhooks/whatsapp/unknown')
      .set('x-hub-signature-256', sign({}))
      .send({});
    expect(r.status).toBe(404);
  });

  it('returns 401 when signature missing', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_A, slug: 'acme' }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return {
            rows: [
              {
                webhook_secret_encrypted: encrypt(SECRET),
                phone_number: '+1',
                waba_id: null,
                api_key_encrypted: null,
                id: 'i-1',
                tenant_id: TENANT_A,
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
      .post('/api/webhooks/whatsapp/acme')
      .send(inboundPayload('wa-1', 'hi'));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('returns 401 when signature is wrong', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_A, slug: 'acme' }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return {
            rows: [
              {
                webhook_secret_encrypted: encrypt(SECRET),
                phone_number: '+1',
                waba_id: null,
                api_key_encrypted: null,
                id: 'i-1',
                tenant_id: TENANT_A,
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
      .post('/api/webhooks/whatsapp/acme')
      .set('x-hub-signature-256', 'sha256=deadbeef')
      .send(inboundPayload('wa-1', 'hi'));
    expect(r.status).toBe(401);
  });

  it('processes inbound message with valid signature', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_A, slug: 'acme' }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return {
            rows: [
              {
                webhook_secret_encrypted: encrypt(SECRET),
                phone_number: '+1',
                waba_id: null,
                api_key_encrypted: null,
                id: 'i-1',
                tenant_id: TENANT_A,
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_messages\s+WHERE\s+tenant_id\s*=\s*\$1\s+AND\s+external_id/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT\s+id\s+FROM\s+candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_messages/i.test(sql)) {
          return {
            rows: [
              {
                id: 'in-1',
                tenant_id: TENANT_A,
                external_id: 'wa-1',
                direction: 'inbound',
                message_type: 'text',
                body_text: 'hi',
                status: 'received',
                created_at: new Date().toISOString(),
                metadata: {},
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+communications/i.test(sql)) {
          return { rows: [{ id: 'comm-1' }], rowCount: 1 };
        }
        if (/UPDATE\s+whatsapp_messages.*communication_id/is.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const body = inboundPayload('wa-1', 'hi');
    const r = await request(app)
      .post('/api/webhooks/whatsapp/acme')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    expect(r.status).toBe(200);
    expect(r.body.data.messages).toBe(1);
  });
});

describe('POST /api/webhooks/whatsapp/:tenantSlug — idempotency', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('treats duplicate external_id as dupe count, not error', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_A, slug: 'acme' }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return {
            rows: [
              {
                webhook_secret_encrypted: encrypt(SECRET),
                phone_number: '+1',
                waba_id: null,
                api_key_encrypted: null,
                id: 'i-1',
                tenant_id: TENANT_A,
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_messages\s+WHERE\s+tenant_id\s*=\s*\$1\s+AND\s+external_id/i.test(sql)) {
          return {
            rows: [
              {
                id: 'in-x',
                tenant_id: TENANT_A,
                external_id: 'wa-dup',
                direction: 'inbound',
                status: 'received',
                message_type: 'text',
                body_text: 'hi',
                created_at: new Date().toISOString(),
                metadata: {},
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
    const body = inboundPayload('wa-dup', 'hi');
    const r = await request(app)
      .post('/api/webhooks/whatsapp/acme')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    expect(r.status).toBe(200);
    expect(r.body.data.dupes).toBe(1);
    expect(r.body.data.messages).toBe(0);
  });
});

describe('POST /api/webhooks/whatsapp/:tenantSlug — status callbacks', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('handles delivery status update', async () => {
    let statusUpdated = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_A, slug: 'acme' }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return {
            rows: [
              {
                webhook_secret_encrypted: encrypt(SECRET),
                phone_number: '+1',
                waba_id: null,
                api_key_encrypted: null,
                id: 'i-1',
                tenant_id: TENANT_A,
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+whatsapp_messages\s+SET\s+status\s*=\s*\$1/i.test(sql)) {
          statusUpdated = true;
          return {
            rows: [
              {
                id: 'msg-out-1',
                tenant_id: TENANT_A,
                status: 'delivered',
                external_id: 'wa-status-1',
                direction: 'outbound',
                message_type: 'text',
                template_variables: [],
                metadata: {},
                created_at: new Date().toISOString(),
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
    const body = statusPayload('wa-status-1', 'delivered');
    const r = await request(app)
      .post('/api/webhooks/whatsapp/acme')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    expect(r.status).toBe(200);
    expect(r.body.data.statuses).toBe(1);
    expect(statusUpdated).toBe(true);
  });

  it('handles failed status with error info', async () => {
    let capturedSql = '';
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_A, slug: 'acme' }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return {
            rows: [
              {
                webhook_secret_encrypted: encrypt(SECRET),
                phone_number: '+1',
                waba_id: null,
                api_key_encrypted: null,
                id: 'i-1',
                tenant_id: TENANT_A,
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+whatsapp_messages\s+SET\s+status\s*=\s*\$1/i.test(sql)) {
          capturedSql = sql;
          return {
            rows: [
              {
                id: 'msg-out-2',
                tenant_id: TENANT_A,
                status: 'failed',
                external_id: 'wa-status-2',
                error_code: '131',
                error_message: 'invalid_phone',
                direction: 'outbound',
                message_type: 'text',
                template_variables: [],
                metadata: {},
                created_at: new Date().toISOString(),
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
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: 'wa-status-2',
                    status: 'failed',
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    errors: [{ code: '131', title: 'invalid_phone' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const r = await request(app)
      .post('/api/webhooks/whatsapp/acme')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    expect(r.status).toBe(200);
    expect(capturedSql).toMatch(/error_code\s*=/i);
  });
});

describe('cross-tenant isolation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it("tenant A's webhook does not affect tenant B's data", async () => {
    let secretLoadedForTenant: string | null = null;
    let insertedForTenant: string | null = null;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_A, slug: 'acme' }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          secretLoadedForTenant = params[0] as string;
          return {
            rows: [
              {
                webhook_secret_encrypted: encrypt(SECRET),
                phone_number: '+1',
                waba_id: null,
                api_key_encrypted: null,
                id: 'i-1',
                tenant_id: TENANT_A,
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_messages\s+WHERE\s+tenant_id\s*=\s*\$1\s+AND\s+external_id/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT\s+id\s+FROM\s+candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_messages/i.test(sql)) {
          insertedForTenant = params[0] as string;
          return {
            rows: [
              {
                id: 'in-iso',
                tenant_id: insertedForTenant,
                external_id: 'wa-iso',
                direction: 'inbound',
                message_type: 'text',
                body_text: 'hi',
                status: 'received',
                created_at: new Date().toISOString(),
                metadata: {},
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+communications/i.test(sql)) {
          return { rows: [{ id: 'comm-iso' }], rowCount: 1 };
        }
        if (/UPDATE\s+whatsapp_messages.*communication_id/is.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    // Even though we POST a body that "claims" tenant_id=TENANT_B (irrelevant —
    // 360dialog payloads don't carry tenant). The slug 'acme' → TENANT_A.
    const body = {
      ...inboundPayload('wa-iso', 'hi'),
      tenant_id: TENANT_B, // attempted hijack
    };
    const r = await request(app)
      .post('/api/webhooks/whatsapp/acme')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    expect(r.status).toBe(200);
    expect(secretLoadedForTenant).toBe(TENANT_A);
    expect(insertedForTenant).toBe(TENANT_A);
  });
});

describe('opt-in keyword detection via webhook', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('JA inbound triggers consent grant via reply', async () => {
    let consentUpserted = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_A, slug: 'acme' }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return {
            rows: [
              {
                webhook_secret_encrypted: encrypt(SECRET),
                phone_number: '+1',
                waba_id: null,
                api_key_encrypted: null,
                id: 'i-1',
                tenant_id: TENANT_A,
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_messages\s+WHERE\s+tenant_id\s*=\s*\$1\s+AND\s+external_id/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT\s+id\s+FROM\s+candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_messages/i.test(sql)) {
          return {
            rows: [
              {
                id: 'in-ja',
                tenant_id: TENANT_A,
                external_id: 'wa-ja',
                candidate_id: CAND_ID,
                direction: 'inbound',
                message_type: 'text',
                body_text: 'JA',
                status: 'received',
                created_at: new Date().toISOString(),
                metadata: {},
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+communications/i.test(sql)) {
          return { rows: [{ id: 'comm-ja' }], rowCount: 1 };
        }
        if (/UPDATE\s+whatsapp_messages.*communication_id/is.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_consents.*ON\s+CONFLICT/is.test(sql)) {
          consentUpserted = true;
          return {
            rows: [
              {
                id: 'c-1',
                tenant_id: TENANT_A,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                status: 'granted',
                opt_in_source: 'reply',
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
    const body = inboundPayload('wa-ja', 'JA');
    const r = await request(app)
      .post('/api/webhooks/whatsapp/acme')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    expect(r.status).toBe(200);
    expect(consentUpserted).toBe(true);
  });
});

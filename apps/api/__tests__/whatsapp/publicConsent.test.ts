/**
 * Public opt-in routes tests — Sprint Q4.6 (Agent ZZZ).
 *
 * Exercises the unauth landing-page endpoints. The Redis-backed rate-limit
 * is auto-disabled in NODE_ENV=test (see publicConsentRoutes.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import publicRouter from '../../src/modules/whatsapp/publicConsentRoutes';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CAND_ID = '33333333-3333-3333-3333-333333333333';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/public/whatsapp', publicRouter);
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

beforeEach(() => vi.clearAllMocks());

describe('GET /api/public/whatsapp/opt-in/:token', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('400 for invalid short token', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app).get('/api/public/whatsapp/opt-in/short');
    expect(r.status).toBe(400);
  });

  it('404 for unknown token', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const r = await request(app).get('/api/public/whatsapp/opt-in/' + 'a'.repeat(32));
    expect(r.status).toBe(404);
  });

  it('returns candidate name + phone for valid token', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_optin_tokens\s+t\s+LEFT\s+JOIN/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                candidate_name: 'Alice Recruiter',
                expires_at: future,
                consumed_at: null,
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
    const r = await request(app).get('/api/public/whatsapp/opt-in/' + 'a'.repeat(32));
    expect(r.status).toBe(200);
    expect(r.body.data.candidate_name).toBe('Alice Recruiter');
    expect(r.body.data.phone_number).toBe('+31612345678');
  });
});

describe('POST /api/public/whatsapp/opt-in/:token/accept', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('grants consent + captures ip+ua', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    let consentInserted = false;
    let capturedIp: string | null = null;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/whatsapp_optin_tokens\s+t\s+LEFT\s+JOIN/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                candidate_name: null,
                expires_at: future,
                consumed_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+whatsapp_optin_tokens\s+SET\s+consumed_at/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_consents/i.test(sql)) {
          consentInserted = true;
          capturedIp = params[3] as string;
          return {
            rows: [
              {
                id: 'c-1',
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                status: 'granted',
                granted_at: new Date().toISOString(),
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
    app.set('trust proxy', true);
    const r = await request(app)
      .post('/api/public/whatsapp/opt-in/' + 'b'.repeat(32) + '/accept')
      .set('user-agent', 'test-ua/1.0')
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('granted');
    expect(consentInserted).toBe(true);
    expect(capturedIp).toBeTruthy();
  });
});

describe('GET /api/public/whatsapp/opt-in/:token/decline', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns 200 with declined status', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_optin_tokens\s+t\s+LEFT\s+JOIN/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                candidate_name: null,
                expires_at: future,
                consumed_at: null,
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
    const r = await request(app).get('/api/public/whatsapp/opt-in/' + 'c'.repeat(32) + '/decline');
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('declined');
  });
});

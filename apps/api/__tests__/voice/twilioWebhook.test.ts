/**
 * Twilio webhook tests — Sprint Q4.6 (Agent AAAA).
 *
 * Verifies HMAC-SHA1 signature, status update, and recording-complete flow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';
import { encrypt } from '../../src/lib/encryption';

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import twilioWebhookRouter, {
  computeTwilioSignature,
} from '../../src/modules/voice/twilioWebhookRoutes';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const WEBHOOK_SECRET = 'super-secret-webhook-token';
const TENANT_SLUG = 'acme';
const CALL_SID = 'CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/webhooks', twilioWebhookRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => vi.clearAllMocks());

function integrationRow(): Record<string, unknown> {
  return {
    id: '77777777-7777-7777-7777-777777777777',
    tenant_id: TENANT_ID,
    provider: 'twilio',
    status: 'connected',
    account_sid: 'ACtest',
    phone_number: '+311234567',
    auth_token_encrypted: encrypt('auth-token'),
    webhook_secret_encrypted: encrypt(WEBHOOK_SECRET),
    connected_by: null,
    connected_at: null,
    last_error: null,
    metadata: {},
    created_at: '2026-05-01T10:00:00Z',
  };
}

function callRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '66666666-6666-6666-6666-666666666666',
    tenant_id: TENANT_ID,
    integration_id: '77777777-7777-7777-7777-777777777777',
    candidate_id: '33333333-3333-3333-3333-333333333333',
    direction: 'outbound',
    status: 'completed',
    from_number: '+311234567',
    to_number: '+316123456',
    external_sid: CALL_SID,
    duration_seconds: 60,
    recording_url: null,
    recording_duration_seconds: null,
    transcription_text: null,
    transcription_status: null,
    voicemail: false,
    notes: null,
    initiated_by: null,
    started_at: null,
    answered_at: null,
    ended_at: '2026-05-01T11:00:00Z',
    communication_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    metadata: {},
    created_at: '2026-05-01T10:00:00Z',
    ...overrides,
  };
}

describe('signature verification', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns 401 when X-Twilio-Signature is missing', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        if (/FROM\s+voice_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const app = buildApp();
    const r = await request(app)
      .post(`/api/webhooks/twilio/${TENANT_SLUG}`)
      .send({ CallSid: CALL_SID, CallStatus: 'completed' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('returns 401 when signature is malformed', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        if (/FROM\s+voice_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const app = buildApp();
    const r = await request(app)
      .post(`/api/webhooks/twilio/${TENANT_SLUG}`)
      .set('X-Twilio-Signature', 'bogus')
      .send({ CallSid: CALL_SID, CallStatus: 'completed' });
    expect(r.status).toBe(401);
  });

  it('accepts a valid HMAC-SHA1 signature', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        if (/FROM\s+voice_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        if (/UPDATE\s+voice_calls/i.test(sql)) {
          return { rows: [callRow()], rowCount: 1 };
        }
        if (/FROM\s+tenant_settings/i.test(sql)) {
          return { rows: [{ auto_transcribe_calls: false }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const app = buildApp();
    const body = { CallSid: CALL_SID, CallStatus: 'completed', CallDuration: '60' };
    const url = `http://127.0.0.1/api/webhooks/twilio/${TENANT_SLUG}`;
    const signature = computeTwilioSignature(url, body, WEBHOOK_SECRET);

    const r = await request(app)
      .post(`/api/webhooks/twilio/${TENANT_SLUG}`)
      .set('Host', '127.0.0.1')
      .set('X-Twilio-Signature', signature)
      .send(body);
    expect(r.status).toBe(200);
    expect(r.body.data.updated).toBe(true);
  });
});

describe('tenant resolution', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns 404 when tenant slug not found', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    const app = buildApp();
    const r = await request(app)
      .post(`/api/webhooks/twilio/unknown`)
      .send({ CallSid: CALL_SID });
    expect(r.status).toBe(404);
  });
});

describe('recording-complete triggers transcription', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('queues transcription when auto_transcribe_calls=true', async () => {
    let transcribeUpdate = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        if (/FROM\s+voice_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        if (/FROM\s+tenant_settings/i.test(sql)) {
          return { rows: [{ auto_transcribe_calls: true }], rowCount: 1 };
        }
        if (/UPDATE\s+voice_calls/i.test(sql) && /transcription_status\s*=\s*'pending'/i.test(sql)) {
          return {
            rows: [callRow({ recording_url: 'https://example.com/r.mp3' })],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+voice_calls/i.test(sql) && /transcription_status\s*=\s*'done'/i.test(sql)) {
          transcribeUpdate = true;
          return {
            rows: [
              callRow({
                transcription_text: 'mock transcript',
                transcription_status: 'done',
              }),
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+voice_calls/i.test(sql)) {
          return {
            rows: [callRow({ recording_url: 'https://example.com/r.mp3' })],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const app = buildApp();
    const body = {
      CallSid: CALL_SID,
      CallStatus: 'completed',
      RecordingUrl: 'https://example.com/r.mp3',
      RecordingDuration: '60',
    };
    const url = `http://127.0.0.1/api/webhooks/twilio/${TENANT_SLUG}`;
    const signature = computeTwilioSignature(url, body, WEBHOOK_SECRET);

    const r = await request(app)
      .post(`/api/webhooks/twilio/${TENANT_SLUG}`)
      .set('Host', '127.0.0.1')
      .set('X-Twilio-Signature', signature)
      .send(body);
    expect(r.status).toBe(200);
    expect(r.body.data.transcribed).toBe(true);
    expect(transcribeUpdate).toBe(true);
  });
});

describe('computeTwilioSignature', () => {
  it('produces deterministic base64 HMAC-SHA1', () => {
    const url = 'http://example.com/x';
    const body = { CallSid: 'abc', CallStatus: 'completed' };
    const sig1 = computeTwilioSignature(url, body, 'secret');
    const sig2 = computeTwilioSignature(url, body, 'secret');
    expect(sig1).toBe(sig2);
    expect(sig1.length).toBeGreaterThan(20);
  });

  it('changes when secret differs', () => {
    const url = 'http://example.com/x';
    const body = { CallSid: 'abc' };
    const a = computeTwilioSignature(url, body, 'one');
    const b = computeTwilioSignature(url, body, 'two');
    expect(a).not.toBe(b);
  });
});

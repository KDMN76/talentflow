/**
 * whatsapp messaging service tests — Sprint Q4.6 (Agent ZZZ).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import {
  sendMessage,
  recordIncomingMessage,
  markStatusUpdate,
  listMessages,
  dispatchOutboundSend,
  WhatsAppConsentMissingError,
  WhatsAppOutsideWindowError,
} from '../../src/modules/whatsapp/messaging.service';
import { encrypt } from '../../src/lib/encryption';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const TEMPLATE_ID = '44444444-4444-4444-4444-444444444444';
const INTEGRATION_ID = '55555555-5555-5555-5555-555555555555';

function integrationRow() {
  return {
    id: INTEGRATION_ID,
    tenant_id: TENANT_ID,
    provider: '360dialog',
    status: 'connected',
    phone_number: '+31612345678',
    api_key_encrypted: encrypt('key1'),
    webhook_secret_encrypted: encrypt('whsec'),
    waba_id: null,
    quality_rating: 'green',
    messaging_limit: 'tier_10k',
    display_name: null,
    connected_by: USER_ID,
    connected_at: new Date().toISOString(),
    last_health_check_at: null,
    last_error: null,
    metadata: {},
    created_at: new Date().toISOString(),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('sendMessage — consent check', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('throws WhatsAppConsentMissingError when consent missing', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_consents/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      sendMessage(TENANT_ID, CAND_ID, { kind: 'text', body: 'hi' }, { userId: USER_ID })
    ).rejects.toBeInstanceOf(WhatsAppConsentMissingError);
  });

  it('throws WhatsAppConsentMissingError when consent is withdrawn', async () => {
    const consent = {
      id: 'c-1',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      phone_number: '+31612345678',
      status: 'withdrawn',
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_consents/i.test(sql)) return { rows: [consent], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      sendMessage(TENANT_ID, CAND_ID, { kind: 'text', body: 'hi' }, { userId: USER_ID })
    ).rejects.toBeInstanceOf(WhatsAppConsentMissingError);
  });
});

describe('sendMessage — 24h window', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('rejects text outside 24h window with WhatsAppOutsideWindowError', async () => {
    const consent = {
      id: 'c-1',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      phone_number: '+31612345678',
      status: 'granted',
    };
    // No prior inbound — window not open.
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_consents/i.test(sql)) return { rows: [consent], rowCount: 1 };
        if (/whatsapp_messages\s+WHERE\s+tenant_id\s*=\s*\$1\s+AND\s+candidate_id/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      sendMessage(TENANT_ID, CAND_ID, { kind: 'text', body: 'hi' }, { userId: USER_ID })
    ).rejects.toBeInstanceOf(WhatsAppOutsideWindowError);
  });

  it('allows text when last inbound was less than 24h ago', async () => {
    const consent = {
      id: 'c-1',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      phone_number: '+31612345678',
      status: 'granted',
    };
    const recentInbound = { created_at: new Date(Date.now() - 60_000).toISOString() };
    const insertedMsg = {
      id: 'msg-1',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      direction: 'outbound',
      message_type: 'text',
      body_text: 'hi',
      status: 'queued',
      external_id: null,
      created_at: new Date().toISOString(),
      template_variables: [],
      metadata: {},
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_consents/i.test(sql)) return { rows: [consent], rowCount: 1 };
        if (/SELECT\s+created_at\s+FROM\s+whatsapp_messages/is.test(sql)) {
          return { rows: [recentInbound], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        if (/SELECT\s+phone\s+FROM\s+candidates/i.test(sql)) {
          return { rows: [{ phone: '+31612345678' }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_messages/i.test(sql)) {
          return { rows: [insertedMsg], rowCount: 1 };
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
    const row = await sendMessage(
      TENANT_ID,
      CAND_ID,
      { kind: 'text', body: 'hi' },
      { userId: USER_ID }
    );
    expect(row.id).toBe('msg-1');
    expect(row.status).toBe('queued');
  });
});

describe('sendMessage — communications dual-write', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('inserts a paired communications row + links whatsapp_messages.communication_id', async () => {
    const consent = {
      id: 'c-1',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      phone_number: '+31612345678',
      status: 'granted',
    };
    const template = {
      id: TEMPLATE_ID,
      tenant_id: TENANT_ID,
      name: 'welcome',
      language: 'nl',
      status: 'approved',
      body: 'Hi {{1}}',
      buttons: [],
      example_variables: [],
    };
    let commInserted = false;
    let waUpdated = false;
    const insertedMsg = {
      id: 'msg-2',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      direction: 'outbound',
      message_type: 'template',
      template_id: TEMPLATE_ID,
      template_variables: [],
      body_text: '[template:welcome]',
      status: 'queued',
      external_id: null,
      created_at: new Date().toISOString(),
      metadata: {},
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_consents/i.test(sql)) return { rows: [consent], rowCount: 1 };
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_templates/i.test(sql)) {
          return { rows: [template], rowCount: 1 };
        }
        if (/SELECT\s+phone\s+FROM\s+candidates/i.test(sql)) {
          return { rows: [{ phone: '+31612345678' }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_messages/i.test(sql)) {
          return { rows: [insertedMsg], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+communications/i.test(sql)) {
          commInserted = true;
          expect(sql).toMatch(/'whatsapp'/i);
          expect(sql).toMatch(/'outbound'/i);
          return { rows: [{ id: 'comm-2' }], rowCount: 1 };
        }
        if (/UPDATE\s+whatsapp_messages.*communication_id/is.test(sql)) {
          waUpdated = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const row = await sendMessage(
      TENANT_ID,
      CAND_ID,
      { kind: 'template', templateId: TEMPLATE_ID, variables: ['John'] },
      { userId: USER_ID }
    );
    expect(commInserted).toBe(true);
    expect(waUpdated).toBe(true);
    expect(row.communication_id).toBe('comm-2');
  });
});

describe('sendMessage — template approval gate', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('rejects non-approved template', async () => {
    const consent = {
      id: 'c-1',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      phone_number: '+31612345678',
      status: 'granted',
    };
    const template = {
      id: TEMPLATE_ID,
      tenant_id: TENANT_ID,
      status: 'submitted',
      name: 'x',
      language: 'nl',
      body: 'b',
      buttons: [],
      example_variables: [],
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_consents/i.test(sql)) return { rows: [consent], rowCount: 1 };
        if (/SELECT\s+\*\s+FROM\s+whatsapp_templates/i.test(sql)) {
          return { rows: [template], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      sendMessage(
        TENANT_ID,
        CAND_ID,
        { kind: 'template', templateId: TEMPLATE_ID, variables: [] },
        { userId: USER_ID }
      )
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_APPROVED' });
  });
});

describe('recordIncomingMessage', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('inserts inbound row + communications row + emits event', async () => {
    const { eventBus } = await import('../../src/lib/eventBus');
    let receivedEvent: unknown = null;
    eventBus.on('whatsappMessageReceived', (e) => {
      receivedEvent = e;
    });

    const inserted = {
      id: 'msg-in-1',
      tenant_id: TENANT_ID,
      direction: 'inbound',
      message_type: 'text',
      body_text: 'hello',
      external_id: 'wa-external-1',
      candidate_id: CAND_ID,
      status: 'received',
      created_at: new Date().toISOString(),
      metadata: {},
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+whatsapp_messages\s+WHERE\s+tenant_id\s*=\s*\$1\s+AND\s+external_id/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT\s+id\s+FROM\s+candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_messages/i.test(sql)) {
          return { rows: [inserted], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+communications/i.test(sql)) {
          return { rows: [{ id: 'comm-in-1' }], rowCount: 1 };
        }
        if (/UPDATE\s+whatsapp_messages.*communication_id/is.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await recordIncomingMessage(TENANT_ID, {
      external_id: 'wa-external-1',
      from_phone: '+31612345678',
      message_type: 'text',
      body_text: 'hello',
    });
    expect(result.isDuplicate).toBe(false);
    expect(result.message.id).toBe('msg-in-1');
    // setImmediate-style: event dispatch happens on next tick. Microtask flush.
    await new Promise((r) => setImmediate(r));
    expect(receivedEvent).not.toBeNull();
  });

  it('returns isDuplicate=true when message already exists', async () => {
    const existing = {
      id: 'msg-in-1',
      tenant_id: TENANT_ID,
      direction: 'inbound',
      external_id: 'wa-external-1',
      body_text: 'hi',
      status: 'received',
      message_type: 'text',
      created_at: new Date().toISOString(),
      metadata: {},
    };
    const client = mockClient({
      __matcher: async () => ({ rows: [existing], rowCount: 1 }),
    });
    teardown = installPoolMock(client);
    const result = await recordIncomingMessage(TENANT_ID, {
      external_id: 'wa-external-1',
      from_phone: '+31612345678',
      message_type: 'text',
      body_text: 'hi',
    });
    expect(result.isDuplicate).toBe(true);
    expect(result.message.id).toBe('msg-in-1');
  });

  it('detects JA opt-in keyword and grants consent', async () => {
    let consentUpserted = false;
    const inserted = {
      id: 'msg-in-2',
      tenant_id: TENANT_ID,
      direction: 'inbound',
      message_type: 'text',
      body_text: 'JA',
      external_id: 'wa-external-2',
      candidate_id: CAND_ID,
      status: 'received',
      created_at: new Date().toISOString(),
      metadata: {},
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+whatsapp_messages\s+WHERE\s+tenant_id\s*=\s*\$1\s+AND\s+external_id/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT\s+id\s+FROM\s+candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_messages/i.test(sql)) {
          return { rows: [inserted], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+communications/i.test(sql)) {
          return { rows: [{ id: 'comm-x' }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_consents.*ON\s+CONFLICT/is.test(sql)) {
          consentUpserted = true;
          return {
            rows: [
              {
                id: 'c-1',
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                status: 'granted',
                opt_in_source: 'reply',
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+whatsapp_messages.*communication_id/is.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await recordIncomingMessage(TENANT_ID, {
      external_id: 'wa-external-2',
      from_phone: '+31612345678',
      message_type: 'text',
      body_text: 'JA',
    });
    expect(consentUpserted).toBe(true);
  });

  it('detects STOP keyword and withdraws consent', async () => {
    let withdrawCalled = false;
    const inserted = {
      id: 'msg-in-3',
      tenant_id: TENANT_ID,
      direction: 'inbound',
      message_type: 'text',
      body_text: 'STOP',
      external_id: 'wa-external-3',
      candidate_id: CAND_ID,
      status: 'received',
      created_at: new Date().toISOString(),
      metadata: {},
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+whatsapp_messages\s+WHERE\s+tenant_id\s*=\s*\$1\s+AND\s+external_id/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT\s+id\s+FROM\s+candidates/i.test(sql)) {
          return { rows: [{ id: CAND_ID }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_messages/i.test(sql)) {
          return { rows: [inserted], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+communications/i.test(sql)) {
          return { rows: [{ id: 'comm-x' }], rowCount: 1 };
        }
        if (/UPDATE\s+whatsapp_messages.*communication_id/is.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE\s+whatsapp_consents/i.test(sql)) {
          withdrawCalled = true;
          return {
            rows: [
              {
                id: 'c-1',
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                status: 'withdrawn',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await recordIncomingMessage(TENANT_ID, {
      external_id: 'wa-external-3',
      from_phone: '+31612345678',
      message_type: 'text',
      body_text: 'STOP',
    });
    expect(withdrawCalled).toBe(true);
  });
});

describe('dispatchOutboundSend — consent re-check at send time', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  function queuedRow() {
    return {
      id: 'msg-dispatch-1',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      integration_id: INTEGRATION_ID,
      direction: 'outbound',
      message_type: 'text',
      template_id: null,
      template_variables: [],
      body_text: 'hi',
      media_url: null,
      status: 'queued',
      external_id: null,
      reply_to_id: null,
      communication_id: null,
      metadata: {},
      created_at: new Date().toISOString(),
    };
  }

  it('blocks the send and marks the message failed when consent was withdrawn after enqueue', async () => {
    let markedFailedWithReason: string | null = null;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/SELECT\s+\*\s+FROM\s+whatsapp_messages\s+WHERE\s+id\s*=\s*\$1/i.test(sql)) {
          return { rows: [queuedRow()], rowCount: 1 };
        }
        // No consent row at all → treated the same as withdrawn.
        if (/FROM\s+whatsapp_consents/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/UPDATE\s+whatsapp_messages[\s\S]*status\s*=\s*'failed'/i.test(sql)) {
          markedFailedWithReason = params[0] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const row = await dispatchOutboundSend(TENANT_ID, 'msg-dispatch-1');

    expect(row.status).toBe('failed');
    expect(row.error_code).toBe('CONSENT_WITHDRAWN');
    expect(markedFailedWithReason).toBe('CONSENT_WITHDRAWN');
  });

  it('proceeds to send when consent is still granted', async () => {
    const consent = {
      id: 'c-1',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      phone_number: '+31612345678',
      status: 'granted',
    };
    let sentUpdateRan = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+whatsapp_messages\s+WHERE\s+id\s*=\s*\$1/i.test(sql)) {
          return { rows: [queuedRow()], rowCount: 1 };
        }
        if (/FROM\s+whatsapp_consents/i.test(sql)) {
          return { rows: [consent], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return { rows: [integrationRow()], rowCount: 1 };
        }
        if (/SELECT\s+phone\s+FROM\s+candidates/i.test(sql)) {
          return { rows: [{ phone: '+31612345678' }], rowCount: 1 };
        }
        if (/UPDATE\s+whatsapp_messages[\s\S]*status\s*=\s*'sent'/i.test(sql)) {
          sentUpdateRan = true;
          return { rows: [{ ...queuedRow(), status: 'sent', external_id: 'wa-out-x' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const row = await dispatchOutboundSend(TENANT_ID, 'msg-dispatch-1');

    expect(sentUpdateRan).toBe(true);
    expect(row.status).toBe('sent');
  });
});

describe('markStatusUpdate', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('updates row status=delivered with timestamp', async () => {
    let updated = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+whatsapp_messages\s+SET\s+status\s*=\s*\$1/i.test(sql)) {
          updated = true;
          return {
            rows: [
              {
                id: 'msg-out-1',
                tenant_id: TENANT_ID,
                status: 'delivered',
                external_id: 'wa-out-1',
                communication_id: 'comm-1',
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
        if (/UPDATE\s+communications\s+SET\s+status/i.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const row = await markStatusUpdate(TENANT_ID, 'wa-out-1', 'delivered');
    expect(updated).toBe(true);
    expect(row?.status).toBe('delivered');
  });

  it('returns null when external_id not found', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    const row = await markStatusUpdate(TENANT_ID, 'nonexistent', 'delivered');
    expect(row).toBeNull();
  });
});

describe('listMessages', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('respects direction filter', async () => {
    let capturedSql = '';
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+whatsapp_messages/i.test(sql)) {
          capturedSql = sql;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await listMessages(TENANT_ID, { direction: 'inbound' });
    expect(capturedSql).toMatch(/direction\s*=\s*\$2/);
  });
});

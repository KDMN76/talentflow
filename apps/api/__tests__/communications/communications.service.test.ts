/**
 * communications.service.ts — sendMessage() channel-dispatch tests.
 *
 * Audit fix: the whatsapp/sms branch used to INSERT a `communications` row
 * with a fabricated `status='sent'` directly, with no provider call and no
 * consent check. It now delegates whatsapp to the real
 * whatsapp/messaging.service (which enforces consent), and returns an
 * honest 501 for sms (no provider integration exists).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

const { sendWhatsAppMessageMock } = vi.hoisted(() => ({
  sendWhatsAppMessageMock: vi.fn(),
}));

vi.mock('../../src/modules/whatsapp/messaging.service', () => ({
  sendMessage: sendWhatsAppMessageMock,
}));

vi.mock('../../src/queue/queues', () => ({
  emailSenderQueue: { add: vi.fn(async () => ({ id: 'mock-job' })) },
}));

import { sendMessage } from '../../src/modules/communications/communications.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => vi.clearAllMocks());

describe('sendMessage — whatsapp channel delegates to the real messaging service', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('calls whatsapp/messaging.service.sendMessage instead of faking a sent row', async () => {
    const client: MockClient = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    sendWhatsAppMessageMock.mockResolvedValue({
      id: 'wa-msg-1',
      communication_id: 'comm-1',
      body_text: 'hi there',
      status: 'queued',
      sent_at: null,
      created_at: '2026-07-19T00:00:00.000Z',
    });

    const result = await sendMessage(TENANT_ID, USER_ID, {
      candidate_id: CAND_ID,
      channel: 'whatsapp',
      body: 'hi there',
    });

    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
      TENANT_ID,
      CAND_ID,
      { kind: 'text', body: 'hi there' },
      { userId: USER_ID }
    );
    // Real (non-fabricated) status coming from the messaging service —
    // never a hardcoded 'sent'.
    expect(result.status).toBe('queued');
    expect(result.id).toBe('comm-1');
    expect(result.channel).toBe('whatsapp');
  });

  it('propagates WhatsAppConsentMissingError (403) instead of silently sending', async () => {
    const client: MockClient = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    sendWhatsAppMessageMock.mockRejectedValue(
      Object.assign(new Error('Kandidaat heeft geen actieve WhatsApp-toestemming gegeven'), {
        statusCode: 403,
        code: 'WHATSAPP_CONSENT_MISSING',
      })
    );

    await expect(
      sendMessage(TENANT_ID, USER_ID, {
        candidate_id: CAND_ID,
        channel: 'whatsapp',
        body: 'hi',
      })
    ).rejects.toMatchObject({ code: 'WHATSAPP_CONSENT_MISSING' });
  });
});

describe('sendMessage — sms channel has no provider', () => {
  it('returns a 501 instead of fabricating a sent row', async () => {
    await expect(
      sendMessage(TENANT_ID, USER_ID, {
        candidate_id: CAND_ID,
        channel: 'sms',
        body: 'hi',
      })
    ).rejects.toMatchObject({ statusCode: 501, code: 'SMS_NOT_IMPLEMENTED' });
    // Never reaches the whatsapp path.
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
  });
});

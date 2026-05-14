/**
 * 360dialog connector tests — Sprint Q4.6 (Agent ZZZ).
 *
 * Mock-mode covers all entry points: sendTemplate/sendText/sendMedia all
 * synthesise external_id values, schedule mock delivery webhooks, and
 * template submission auto-emits a `template-approved` event after 2s.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as dialog360 from '../../src/modules/whatsapp/connector/dialog360';

const creds: dialog360.IntegrationCreds = {
  id: '11111111-1111-1111-1111-111111111111',
  tenant_id: '22222222-2222-2222-2222-222222222222',
  phone_number: '+31612345678',
  waba_id: 'waba-1',
  api_key: 'test-api-key',
};

beforeEach(() => {
  delete process.env.WHATSAPP_360DIALOG_LIVE;
});

afterEach(() => {
  dialog360.mockEvents.removeAllListeners();
});

describe('dialog360 connector — mock mode', () => {
  it('isLive() returns false by default', () => {
    expect(dialog360.isLive()).toBe(false);
  });

  it('isLive() returns true when env flag set', () => {
    process.env.WHATSAPP_360DIALOG_LIVE = 'true';
    expect(dialog360.isLive()).toBe(true);
  });

  it('sendTemplateMessage returns synthetic external_id', async () => {
    const result = await dialog360.sendTemplateMessage(creds, '+31612345678', 'tpl_x', 'nl', ['John']);
    expect(result.external_id).toMatch(/^wa-mock-/);
    expect(result.status).toBe('sent');
    expect(result.conversation_id).toMatch(/^conv-mock-/);
  });

  it('sendTextMessage returns synthetic external_id', async () => {
    const result = await dialog360.sendTextMessage(creds, '+31612345678', 'hi');
    expect(result.external_id).toMatch(/^wa-mock-/);
    expect(result.status).toBe('sent');
  });

  it('sendMediaMessage returns synthetic external_id', async () => {
    const result = await dialog360.sendMediaMessage(
      creds,
      '+31612345678',
      'https://example.com/x.jpg',
      'image',
      'caption'
    );
    expect(result.external_id).toMatch(/^wa-mock-/);
  });

  it('schedules a mock delivery webhook within 1.5s', async () => {
    vi.useFakeTimers();
    const captured: dialog360.MockDeliveryEvent[] = [];
    dialog360.mockEvents.on('delivery', (e: dialog360.MockDeliveryEvent) => captured.push(e));
    const result = await dialog360.sendTextMessage(creds, '+31612345678', 'hi');
    vi.advanceTimersByTime(1100);
    expect(captured.length).toBe(1);
    expect(captured[0].externalId).toBe(result.external_id);
    expect(captured[0].status).toBe('delivered');
    vi.useRealTimers();
  });

  it('markRead is a no-op in mock mode', async () => {
    await expect(dialog360.markRead(creds, 'wa-mock-x')).resolves.toBeUndefined();
  });

  it('submitTemplateForReview returns submitted then emits approval after 2s', async () => {
    vi.useFakeTimers();
    let approvedExternalId: string | null = null;
    dialog360.mockEvents.on('template-approved', (e: { tenantId: string; externalId: string }) => {
      approvedExternalId = e.externalId;
    });
    const result = await dialog360.submitTemplateForReview(creds, {
      name: 'welcome',
      language: 'nl',
      category: 'utility',
      body: 'Hi {{1}}',
    });
    expect(result.external_id).toMatch(/^wa-tpl-mock-/);
    expect(result.status).toBe('submitted');
    vi.advanceTimersByTime(2100);
    expect(approvedExternalId).toBe(result.external_id);
    vi.useRealTimers();
  });

  it('getAccountInfo returns mock quality_rating green', async () => {
    const info = await dialog360.getAccountInfo(creds);
    expect(info.quality_rating).toBe('green');
    expect(info.messaging_limit).toBe('tier_10k');
    expect(info.phone_number_id).toContain('mock-pn-');
  });

  it('getTemplateStatus returns approved for synthetic id', async () => {
    const result = await dialog360.getTemplateStatus(creds, 'wa-tpl-mock-x');
    expect(result.status).toBe('approved');
  });
});

describe('verifyWebhookSignature', () => {
  it('returns false for missing signature', () => {
    expect(dialog360.verifyWebhookSignature('hello', undefined, 'secret')).toBe(false);
  });

  it('returns false for missing secret', () => {
    expect(dialog360.verifyWebhookSignature('hello', 'sha256=deadbeef', '')).toBe(false);
  });

  it('verifies a valid sha256= prefixed signature', () => {
    const crypto = require('node:crypto');
    const body = '{"x":1}';
    const sig = `sha256=${crypto.createHmac('sha256', 'sec').update(body).digest('hex')}`;
    expect(dialog360.verifyWebhookSignature(body, sig, 'sec')).toBe(true);
  });

  it('verifies a bare-hex signature', () => {
    const crypto = require('node:crypto');
    const body = '{"x":1}';
    const sig = crypto.createHmac('sha256', 'sec').update(body).digest('hex');
    expect(dialog360.verifyWebhookSignature(body, sig, 'sec')).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const body = '{"x":1}';
    expect(dialog360.verifyWebhookSignature(body, 'sha256=deadbeef', 'sec')).toBe(false);
  });

  it('rejects wrong secret', () => {
    const crypto = require('node:crypto');
    const body = '{"x":1}';
    const sig = `sha256=${crypto.createHmac('sha256', 'a').update(body).digest('hex')}`;
    expect(dialog360.verifyWebhookSignature(body, sig, 'b')).toBe(false);
  });
});

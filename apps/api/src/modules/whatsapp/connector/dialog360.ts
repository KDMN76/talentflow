/**
 * 360dialog WhatsApp Business connector — Sprint Q4.6 (Agent ZZZ).
 *
 * 360dialog is the EU-favourite Meta BSP (Business Solution Provider) for
 * WhatsApp Business. Each tenant has one connection with its own API key,
 * encrypted at rest in `whatsapp_integrations.api_key_encrypted`.
 *
 * Authentication: D360-API-KEY header.
 * Base URL: https://waba-v2.360dialog.io
 *
 * Mock mode (default): activated when WHATSAPP_360DIALOG_LIVE !== 'true'.
 * Mock-mode synthesises external_id values and simulates webhook delivery
 * receipts after 1 second via an in-memory EventEmitter so end-to-end tests
 * can drive the full lifecycle without any network.
 */

import axios, { type AxiosResponse } from 'axios';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { logger } from '../../../middleware/errorHandler';

export const DIALOG360_BASE_URL = 'https://waba-v2.360dialog.io';

/**
 * `IntegrationCreds` — the bits the connector needs to call 360dialog. Pass
 * a decrypted api_key here; callers (services) handle decryption via
 * `lib/encryption.ts`.
 */
export interface IntegrationCreds {
  id: string;
  tenant_id: string;
  phone_number: string;
  waba_id: string | null;
  api_key: string;
}

export interface TemplateInput {
  name: string;
  language: string;
  category: 'marketing' | 'utility' | 'authentication';
  header?: { type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'; text?: string; media_url?: string } | null;
  body: string;
  footer?: string | null;
  buttons?: Array<Record<string, unknown>>;
  example_variables?: unknown[];
}

export interface SendResult {
  external_id: string;
  status: 'sent' | 'failed';
  conversation_id: string | null;
}

export interface AccountInfo {
  phone_number_id: string;
  quality_rating: 'green' | 'yellow' | 'red' | 'unknown';
  messaging_limit:
    | 'tier_1k'
    | 'tier_10k'
    | 'tier_100k'
    | 'tier_unlimited'
    | null;
}

export interface TemplateSubmitResult {
  external_id: string;
  status: 'submitted' | 'approved' | 'rejected';
  rejection_reason?: string | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Mode detection
// ───────────────────────────────────────────────────────────────────────────

export function isLive(): boolean {
  return process.env.WHATSAPP_360DIALOG_LIVE === 'true';
}

// ───────────────────────────────────────────────────────────────────────────
// In-memory mock event bus
// ───────────────────────────────────────────────────────────────────────────
//
// Tests subscribe to `mockEvents` to assert that the connector "delivered"
// a synthetic webhook for a mock send. Production code never touches this.

export const mockEvents = new EventEmitter();
mockEvents.setMaxListeners(50);

export interface MockDeliveryEvent {
  tenantId: string;
  externalId: string;
  status: 'delivered' | 'read' | 'failed';
}

function scheduleMockDelivery(
  tenantId: string,
  externalId: string,
  status: 'delivered' | 'read' | 'failed' = 'delivered',
  delayMs = 1000
): void {
  setTimeout(() => {
    mockEvents.emit('delivery', { tenantId, externalId, status } satisfies MockDeliveryEvent);
  }, delayMs).unref?.();
}

function ulid(): string {
  // Quick ULID-ish — sortable timestamp + random suffix. No external dep.
  return (
    Date.now().toString(36) +
    crypto.randomBytes(8).toString('hex').slice(0, 10)
  );
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ───────────────────────────────────────────────────────────────────────────

function authHeaders(creds: IntegrationCreds): Record<string, string> {
  return {
    'D360-API-KEY': creds.api_key,
    'Content-Type': 'application/json',
  };
}

async function dialogPost<T>(
  creds: IntegrationCreds,
  path: string,
  body: unknown
): Promise<AxiosResponse<T>> {
  return axios.post<T>(`${DIALOG360_BASE_URL}${path}`, body, {
    headers: authHeaders(creds),
    timeout: 15_000,
  });
}

async function dialogGet<T>(
  creds: IntegrationCreds,
  path: string
): Promise<AxiosResponse<T>> {
  return axios.get<T>(`${DIALOG360_BASE_URL}${path}`, {
    headers: authHeaders(creds),
    timeout: 15_000,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Send a template message. Required for any outbound contact outside the
 * 24h conversation window. Templates must be Meta-approved.
 */
export async function sendTemplateMessage(
  creds: IntegrationCreds,
  to: string,
  templateName: string,
  language: string,
  variables: unknown[]
): Promise<SendResult> {
  if (!isLive()) {
    const id = `wa-mock-${ulid()}`;
    logger.info('[dialog360.mock] sendTemplate', { to, templateName, language });
    scheduleMockDelivery(creds.tenant_id, id, 'delivered');
    return { external_id: id, status: 'sent', conversation_id: `conv-mock-${id.slice(-8)}` };
  }

  const components = variables.length
    ? [
        {
          type: 'body',
          parameters: variables.map((v) => ({ type: 'text', text: String(v) })),
        },
      ]
    : [];

  const resp = await dialogPost<{ messages: Array<{ id: string }>; contacts?: unknown[] }>(
    creds,
    '/messages',
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: language }, components },
    }
  );
  const externalId = resp.data?.messages?.[0]?.id;
  if (!externalId) throw new Error('dialog360: missing message id in response');
  return { external_id: externalId, status: 'sent', conversation_id: null };
}

/**
 * Send free-form text — only valid within an open 24h conversation window
 * (i.e. as a reply to a recent inbound message from the candidate).
 */
export async function sendTextMessage(
  creds: IntegrationCreds,
  to: string,
  body: string,
  replyToExternalId?: string
): Promise<SendResult> {
  if (!isLive()) {
    const id = `wa-mock-${ulid()}`;
    logger.info('[dialog360.mock] sendText', { to, replyToExternalId });
    scheduleMockDelivery(creds.tenant_id, id, 'delivered');
    return { external_id: id, status: 'sent', conversation_id: `conv-mock-${id.slice(-8)}` };
  }

  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  };
  if (replyToExternalId) payload.context = { message_id: replyToExternalId };

  const resp = await dialogPost<{ messages: Array<{ id: string }> }>(
    creds,
    '/messages',
    payload
  );
  const externalId = resp.data?.messages?.[0]?.id;
  if (!externalId) throw new Error('dialog360: missing message id in response');
  return { external_id: externalId, status: 'sent', conversation_id: null };
}

/**
 * Send a media message (image, video, document) — also requires open window
 * unless used within an approved template.
 */
export async function sendMediaMessage(
  creds: IntegrationCreds,
  to: string,
  mediaUrl: string,
  mediaType: 'image' | 'video' | 'document' | 'audio',
  caption?: string
): Promise<SendResult> {
  if (!isLive()) {
    const id = `wa-mock-${ulid()}`;
    logger.info('[dialog360.mock] sendMedia', { to, mediaType });
    scheduleMockDelivery(creds.tenant_id, id, 'delivered');
    return { external_id: id, status: 'sent', conversation_id: `conv-mock-${id.slice(-8)}` };
  }

  const media: Record<string, unknown> = { link: mediaUrl };
  if (caption && (mediaType === 'image' || mediaType === 'video' || mediaType === 'document')) {
    media.caption = caption;
  }
  const resp = await dialogPost<{ messages: Array<{ id: string }> }>(
    creds,
    '/messages',
    {
      messaging_product: 'whatsapp',
      to,
      type: mediaType,
      [mediaType]: media,
    }
  );
  const externalId = resp.data?.messages?.[0]?.id;
  if (!externalId) throw new Error('dialog360: missing message id in response');
  return { external_id: externalId, status: 'sent', conversation_id: null };
}

/**
 * Acknowledge inbound message as read — triggers the blue ticks in WhatsApp.
 */
export async function markRead(
  creds: IntegrationCreds,
  externalMessageId: string
): Promise<void> {
  if (!isLive()) {
    logger.info('[dialog360.mock] markRead', { externalMessageId });
    return;
  }
  await dialogPost<unknown>(creds, '/messages', {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: externalMessageId,
  });
}

/**
 * Submit a template for Meta review. In mock mode we auto-approve after 2
 * seconds via the mockEvents bus (the service's `submitTemplate` flips the
 * row state then).
 */
export async function submitTemplateForReview(
  creds: IntegrationCreds,
  template: TemplateInput
): Promise<TemplateSubmitResult> {
  if (!isLive()) {
    const id = `wa-tpl-mock-${ulid()}`;
    logger.info('[dialog360.mock] submitTemplate', { name: template.name });
    setTimeout(() => {
      mockEvents.emit('template-approved', {
        tenantId: creds.tenant_id,
        externalId: id,
      });
    }, 2000).unref?.();
    return { external_id: id, status: 'submitted' };
  }

  const resp = await dialogPost<{ id: string; status?: string }>(
    creds,
    '/configs/templates',
    {
      name: template.name,
      language: template.language,
      category: template.category.toUpperCase(),
      components: buildTemplateComponents(template),
    }
  );
  if (!resp.data?.id) throw new Error('dialog360: template submit missing id');
  return { external_id: resp.data.id, status: 'submitted' };
}

function buildTemplateComponents(t: TemplateInput): unknown[] {
  const components: unknown[] = [];
  if (t.header) {
    if (t.header.type === 'TEXT') {
      components.push({ type: 'HEADER', format: 'TEXT', text: t.header.text ?? '' });
    } else {
      components.push({ type: 'HEADER', format: t.header.type, example: { header_url: [t.header.media_url] } });
    }
  }
  components.push({ type: 'BODY', text: t.body, example: { body_text: [t.example_variables ?? []] } });
  if (t.footer) components.push({ type: 'FOOTER', text: t.footer });
  if (t.buttons && t.buttons.length > 0) components.push({ type: 'BUTTONS', buttons: t.buttons });
  return components;
}

export async function getTemplateStatus(
  creds: IntegrationCreds,
  externalTemplateId: string
): Promise<TemplateSubmitResult> {
  if (!isLive()) {
    // In mock mode we treat any lookup as "approved" — the service tracks
    // the actual state and only calls this when it wants to verify.
    return { external_id: externalTemplateId, status: 'approved' };
  }
  const resp = await dialogPost<{ status: string; rejected_reason?: string | null }>(
    creds,
    `/configs/templates/${externalTemplateId}`,
    {}
  );
  const status = (resp.data?.status ?? '').toLowerCase();
  if (status === 'approved') return { external_id: externalTemplateId, status: 'approved' };
  if (status === 'rejected')
    return {
      external_id: externalTemplateId,
      status: 'rejected',
      rejection_reason: resp.data?.rejected_reason ?? null,
    };
  return { external_id: externalTemplateId, status: 'submitted' };
}

export async function getAccountInfo(
  creds: IntegrationCreds
): Promise<AccountInfo> {
  if (!isLive()) {
    return {
      phone_number_id: `mock-pn-${creds.tenant_id.slice(0, 8)}`,
      quality_rating: 'green',
      messaging_limit: 'tier_10k',
    };
  }
  const resp = await dialogGet<{
    phone_number_id: string;
    quality_rating?: string;
    messaging_limit?: string;
  }>(creds, '/account');
  const quality = (resp.data?.quality_rating ?? 'unknown').toLowerCase();
  const ml = (resp.data?.messaging_limit ?? '').toLowerCase();
  return {
    phone_number_id: resp.data?.phone_number_id ?? '',
    quality_rating:
      quality === 'green' || quality === 'yellow' || quality === 'red'
        ? (quality as AccountInfo['quality_rating'])
        : 'unknown',
    messaging_limit:
      ml === 'tier_1k' || ml === 'tier_10k' || ml === 'tier_100k' || ml === 'tier_unlimited'
        ? (ml as AccountInfo['messaging_limit'])
        : null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// HMAC signature verification (for inbound webhooks)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Verify the X-Hub-Signature-256 header against the raw body using the
 * tenant's webhook_secret.
 *
 * Accepts both `sha256=<hex>` and bare hex forms.
 */
export function verifyWebhookSignature(
  rawBody: string,
  providedSignature: string | undefined,
  secret: string
): boolean {
  if (!providedSignature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const candidates = providedSignature.split(',').map((s) => s.split('=').pop() ?? '');
  const expectedBuf = Buffer.from(expected, 'hex');
  for (const candidate of candidates) {
    if (!candidate) continue;
    let buf: Buffer;
    try {
      buf = Buffer.from(candidate, 'hex');
    } catch {
      continue;
    }
    if (buf.length === expectedBuf.length && crypto.timingSafeEqual(buf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

// Re-exports for tests.
export const __test = { scheduleMockDelivery, ulid };

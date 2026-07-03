/**
 * WhatsApp messaging service — Sprint Q4.6 (Agent ZZZ).
 *
 * Owns the lifecycle of `whatsapp_messages`. Dual-writes every outbound +
 * inbound message into the existing `communications` table (Q3.1) so AAAA's
 * omni-channel inbox aggregates WhatsApp alongside email/voice.
 *
 * Outbound rules:
 *   - Candidate MUST have `whatsapp_consents.status = 'granted'`.
 *   - Free-form text only inside the 24h conversation window (last inbound
 *     within 24h). Outside the window → must use a template.
 *
 * Inbound rules:
 *   - Resolve candidate by phone number (fallback to null if unknown — row
 *     is still persisted for recruiter review).
 *   - Detect `JA/AKKOORD/YES` opt-in keyword → grant consent.
 *   - Detect `STOP/STOPPEN` withdraw keyword → withdraw consent + emit
 *     `whatsappConsentWithdrawn`.
 *   - Idempotent on `(tenant_id, external_id)` — duplicate webhooks are
 *     no-ops.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { eventBus } from '../../lib/eventBus';
import { whatsappOutQueue } from '../../queue/queues';
import * as dialog360 from './connector/dialog360';
import {
  loadConnectorCreds,
  getIntegrationWithSecrets,
} from './whatsapp.service';
import { getTemplate } from './templates.service';
import {
  detectOptInKeyword,
  detectStopKeyword,
  grantConsentViaReply,
  withdrawConsent,
  getConsent,
} from './consent.service';

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface WhatsAppMessageRow {
  id: string;
  tenant_id: string;
  integration_id: string | null;
  candidate_id: string | null;
  conversation_id: string | null;
  direction: 'outbound' | 'inbound';
  message_type: string;
  template_id: string | null;
  template_variables: unknown[];
  body_text: string | null;
  media_url: string | null;
  media_mime: string | null;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  external_id: string | null;
  reply_to_id: string | null;
  pricing_category: string | null;
  pricing_amount_cents: number | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  error_code: string | null;
  error_message: string | null;
  communication_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export class WhatsAppConsentMissingError extends AppError {
  constructor() {
    super(
      403,
      'WHATSAPP_CONSENT_MISSING',
      'Kandidaat heeft geen actieve WhatsApp-toestemming gegeven'
    );
  }
}

export class WhatsAppOutsideWindowError extends AppError {
  constructor() {
    super(
      409,
      'WHATSAPP_OUTSIDE_WINDOW',
      'Buiten het 24-uurs gespreksvenster — gebruik een goedgekeurde template in plaats van vrije tekst'
    );
  }
}

export interface SendMessageInput {
  kind: 'text' | 'template' | 'media';
  body?: string;
  templateId?: string;
  variables?: unknown[];
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'document' | 'audio';
  caption?: string;
  replyToId?: string;
}

export interface SendOperationCtx {
  userId: string;
  auditCtx?: AuditContext;
}

// ───────────────────────────────────────────────────────────────────────────
// Outbound — sendMessage
// ───────────────────────────────────────────────────────────────────────────

/**
 * Insert a queued WhatsApp message row + corresponding communications row,
 * then push to BullMQ. The actual send happens in the worker, which calls
 * `dispatchOutboundSend`.
 */
export async function sendMessage(
  tenantId: string,
  candidateId: string,
  input: SendMessageInput,
  ctx: SendOperationCtx
): Promise<WhatsAppMessageRow> {
  // Bevroren feature-guard: in productie zonder live 360dialog-koppeling zou
  // de mock-connector "sent/delivered" faken. Eerlijke 503 in plaats daarvan.
  if (!dialog360.isServiceActive()) {
    throw new AppError(
      503,
      'WHATSAPP_NOT_ENABLED',
      'WhatsApp is niet geactiveerd in deze omgeving. Berichten kunnen niet verstuurd worden.'
    );
  }

  const consent = await getConsent(tenantId, candidateId);
  if (!consent || consent.status !== 'granted') {
    throw new WhatsAppConsentMissingError();
  }

  if (input.kind === 'text') {
    const withinWindow = await isWithin24hWindow(tenantId, candidateId);
    if (!withinWindow) throw new WhatsAppOutsideWindowError();
    if (!input.body || input.body.trim().length === 0) {
      throw new AppError(400, 'EMPTY_BODY', 'body is verplicht voor text-berichten');
    }
  } else if (input.kind === 'template') {
    if (!input.templateId) {
      throw new AppError(400, 'TEMPLATE_REQUIRED', 'templateId is verplicht voor template-berichten');
    }
    const template = await getTemplate(tenantId, input.templateId);
    if (template.status !== 'approved') {
      throw new AppError(
        409,
        'TEMPLATE_NOT_APPROVED',
        'Template is niet goedgekeurd door Meta'
      );
    }
  } else if (input.kind === 'media') {
    if (!input.mediaUrl) {
      throw new AppError(400, 'MEDIA_URL_REQUIRED', 'mediaUrl is verplicht voor media-berichten');
    }
  }

  const integration = await getIntegrationWithSecrets(tenantId);
  if (!integration || integration.status !== 'connected') {
    throw new AppError(400, 'INTEGRATION_NOT_CONFIGURED', 'WhatsApp-integratie niet verbonden');
  }

  // Resolve template metadata for the row.
  let templateName: string | null = null;
  if (input.kind === 'template' && input.templateId) {
    try {
      const t = await getTemplate(tenantId, input.templateId);
      templateName = t.name;
    } catch {
      /* already validated above */
    }
  }

  const previewBody =
    input.kind === 'text'
      ? input.body ?? null
      : input.kind === 'template'
        ? `[template:${templateName}]`
        : `[media:${input.mediaType ?? 'unknown'}]`;

  const subjectForInbox =
    input.kind === 'template' && templateName
      ? templateName
      : (input.body ?? input.caption ?? '').slice(0, 60);

  return withTenant(tenantId, async (client) => {
    // Resolve candidate phone for the inbox aggregator.
    const { rows: [cand] } = await client.query<{ phone: string | null }>(
      `SELECT phone FROM candidates WHERE id = $1 AND tenant_id = $2`,
      [candidateId, tenantId]
    );
    if (!cand) throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');

    const messageType =
      input.kind === 'text' ? 'text' : input.kind === 'template' ? 'template' : (input.mediaType ?? 'image');

    const { rows: [whatsappRow] } = await client.query<WhatsAppMessageRow>(
      `INSERT INTO whatsapp_messages
         (tenant_id, integration_id, candidate_id,
          direction, message_type, template_id, template_variables,
          body_text, media_url, media_mime, status, reply_to_id, metadata)
       VALUES ($1, $2, $3,
               'outbound', $4, $5, $6::jsonb,
               $7, $8, $9, 'queued', $10, '{}'::jsonb)
       RETURNING *`,
      [
        tenantId,
        integration.id,
        candidateId,
        messageType,
        input.templateId ?? null,
        JSON.stringify(input.variables ?? []),
        previewBody,
        input.mediaUrl ?? null,
        input.mediaType ?? null,
        input.replyToId ?? null,
      ]
    );

    // Dual-write into the communications table so AAAA's inbox sees it.
    const { rows: [commRow] } = await client.query<{ id: string }>(
      `INSERT INTO communications
         (tenant_id, candidate_id, channel, direction, subject, body, status, sent_at)
       VALUES ($1, $2, 'whatsapp', 'outbound', $3, $4, 'queued', now())
       RETURNING id`,
      [tenantId, candidateId, subjectForInbox, previewBody]
    );

    await client.query(
      `UPDATE whatsapp_messages
          SET communication_id = $1
        WHERE id = $2 AND tenant_id = $3`,
      [commRow.id, whatsappRow.id, tenantId]
    );
    whatsappRow.communication_id = commRow.id;

    await logAudit(
      client,
      tenantId,
      {
        action: 'whatsapp.message.queued',
        entityType: 'whatsapp_message',
        entityId: whatsappRow.id,
        userId: ctx.userId,
        after: { kind: input.kind, candidate_id: candidateId },
      },
      ctx.auditCtx ?? {}
    );
    return whatsappRow;
  }).then(async (row) => {
    await whatsappOutQueue.add('send-whatsapp', {
      tenantId,
      whatsappMessageId: row.id,
    });
    return row;
  });
}

/**
 * Check whether the candidate has sent an inbound message within the last
 * 24 hours, which keeps the WhatsApp conversation window "open" for
 * free-form replies.
 */
export async function isWithin24hWindow(
  tenantId: string,
  candidateId: string
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<{ created_at: string }>(
      `SELECT created_at FROM whatsapp_messages
         WHERE tenant_id = $1 AND candidate_id = $2 AND direction = 'inbound'
         ORDER BY created_at DESC LIMIT 1`,
      [tenantId, candidateId]
    );
    if (!row) return false;
    const last = new Date(row.created_at).getTime();
    return Date.now() - last < WINDOW_24H_MS;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Inbound — recordIncomingMessage
// ───────────────────────────────────────────────────────────────────────────

export interface IncomingPayload {
  external_id: string;
  from_phone: string;
  message_type: string;
  body_text?: string | null;
  media_url?: string | null;
  media_mime?: string | null;
  conversation_id?: string | null;
  timestamp?: string | null;
}

/**
 * Insert an inbound `whatsapp_messages` row + a paired `communications` row.
 * Idempotent on `(tenant_id, external_id)` — duplicate inserts are ignored
 * and we return the existing row.
 *
 * After insertion we:
 *   - emit `whatsappMessageReceived`
 *   - detect opt-in keyword → grant consent
 *   - detect STOP keyword → withdraw consent
 */
export async function recordIncomingMessage(
  tenantId: string,
  payload: IncomingPayload
): Promise<{ message: WhatsAppMessageRow; isDuplicate: boolean }> {
  // Idempotency: short-circuit if we already have this external_id.
  const existing = await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<WhatsAppMessageRow>(
      `SELECT * FROM whatsapp_messages
         WHERE tenant_id = $1 AND external_id = $2
         LIMIT 1`,
      [tenantId, payload.external_id]
    );
    return row ?? null;
  });
  if (existing) {
    return { message: existing, isDuplicate: true };
  }

  // Resolve candidate by phone number (best-effort).
  const candidateId = await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<{ id: string }>(
      `SELECT id FROM candidates
         WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL
         LIMIT 1`,
      [tenantId, payload.from_phone]
    );
    return row?.id ?? null;
  });

  const integration = await getIntegrationWithSecrets(tenantId);

  const inserted = await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<WhatsAppMessageRow>(
      `INSERT INTO whatsapp_messages
         (tenant_id, integration_id, candidate_id, conversation_id,
          direction, message_type, body_text, media_url, media_mime,
          status, external_id, sent_at, metadata)
       VALUES ($1, $2, $3, $4,
               'inbound', $5, $6, $7, $8,
               'received', $9, COALESCE($10::timestamptz, now()), '{}'::jsonb)
       ON CONFLICT (tenant_id, external_id) DO NOTHING
       RETURNING *`,
      [
        tenantId,
        integration?.id ?? null,
        candidateId,
        payload.conversation_id ?? null,
        payload.message_type,
        payload.body_text ?? null,
        payload.media_url ?? null,
        payload.media_mime ?? null,
        payload.external_id,
        payload.timestamp ?? null,
      ]
    );
    if (!row) {
      // ON CONFLICT fired — race with a concurrent webhook. Re-fetch.
      const { rows: [existing2] } = await client.query<WhatsAppMessageRow>(
        `SELECT * FROM whatsapp_messages
           WHERE tenant_id = $1 AND external_id = $2
           LIMIT 1`,
        [tenantId, payload.external_id]
      );
      return existing2;
    }

    // Dual-write to communications.
    if (candidateId) {
      const subject = (payload.body_text ?? '').slice(0, 60) || '[WhatsApp]';
      const { rows: [comm] } = await client.query<{ id: string }>(
        `INSERT INTO communications
           (tenant_id, candidate_id, channel, direction, subject, body, status, sent_at)
         VALUES ($1, $2, 'whatsapp', 'inbound', $3, $4, 'received', COALESCE($5::timestamptz, now()))
         RETURNING id`,
        [tenantId, candidateId, subject, payload.body_text ?? null, payload.timestamp ?? null]
      );
      await client.query(
        `UPDATE whatsapp_messages
            SET communication_id = $1
          WHERE id = $2 AND tenant_id = $3`,
        [comm.id, row.id, tenantId]
      );
      row.communication_id = comm.id;
    }
    return row;
  });

  if (!inserted) {
    throw new AppError(500, 'INSERT_FAILED', 'Kon WhatsApp-bericht niet opslaan');
  }

  eventBus.emit('whatsappMessageReceived', {
    tenantId,
    messageId: inserted.id,
    candidateId,
    phoneNumber: payload.from_phone,
    body: payload.body_text ?? null,
    externalId: payload.external_id,
  });

  // Keyword handling: opt-in / stop. We only act if we can link a candidate.
  if (candidateId) {
    if (detectOptInKeyword(payload.body_text)) {
      try {
        await grantConsentViaReply(tenantId, candidateId, payload.from_phone, inserted.id);
      } catch (err) {
        logger.warn('[whatsapp.messaging] opt-in keyword grant failed', {
          error: (err as Error).message,
          messageId: inserted.id,
        });
      }
    } else if (detectStopKeyword(payload.body_text)) {
      try {
        await withdrawConsent(tenantId, candidateId, 'inbound STOP keyword');
      } catch (err) {
        logger.warn('[whatsapp.messaging] stop keyword withdraw failed', {
          error: (err as Error).message,
          messageId: inserted.id,
        });
      }
    }
  }

  return { message: inserted, isDuplicate: false };
}

// ───────────────────────────────────────────────────────────────────────────
// Outbound dispatcher — invoked by the BullMQ worker
// ───────────────────────────────────────────────────────────────────────────

/**
 * Pulled from the `whatsappOut` queue. Decrypts API key, calls 360dialog,
 * updates the row + paired communications row. Throws on connector errors
 * so BullMQ can retry.
 */
export async function dispatchOutboundSend(
  tenantId: string,
  whatsappMessageId: string
): Promise<WhatsAppMessageRow> {
  const message = await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<WhatsAppMessageRow>(
      `SELECT * FROM whatsapp_messages
         WHERE id = $1 AND tenant_id = $2`,
      [whatsappMessageId, tenantId]
    );
    if (!row) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Bericht niet gevonden');
    return row;
  });

  if (message.status !== 'queued') {
    logger.info('[whatsapp.messaging] skip dispatch — not queued', {
      whatsappMessageId,
      status: message.status,
    });
    return message;
  }

  const creds = await loadConnectorCreds(tenantId);

  // Resolve recipient phone number.
  const phone = await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<{ phone: string | null }>(
      `SELECT phone FROM candidates WHERE id = $1 AND tenant_id = $2`,
      [message.candidate_id, tenantId]
    );
    return row?.phone ?? null;
  });
  if (!phone) {
    await markFailed(tenantId, whatsappMessageId, 'NO_PHONE', 'Geen telefoonnummer voor kandidaat');
    throw new AppError(400, 'NO_PHONE', 'Geen telefoonnummer voor kandidaat');
  }

  try {
    let sendResult: dialog360.SendResult;
    if (message.message_type === 'template' && message.template_id) {
      const template = await getTemplate(tenantId, message.template_id);
      sendResult = await dialog360.sendTemplateMessage(
        creds,
        phone,
        template.name,
        template.language,
        message.template_variables ?? []
      );
    } else if (
      message.message_type === 'image' ||
      message.message_type === 'video' ||
      message.message_type === 'document' ||
      message.message_type === 'audio'
    ) {
      sendResult = await dialog360.sendMediaMessage(
        creds,
        phone,
        message.media_url!,
        message.message_type as 'image' | 'video' | 'document' | 'audio'
      );
    } else {
      let replyExternal: string | undefined;
      if (message.reply_to_id) {
        const replyRow = await withTenant(tenantId, async (client) => {
          const { rows: [r] } = await client.query<{ external_id: string | null }>(
            `SELECT external_id FROM whatsapp_messages
               WHERE id = $1 AND tenant_id = $2`,
            [message.reply_to_id, tenantId]
          );
          return r;
        });
        replyExternal = replyRow?.external_id ?? undefined;
      }
      sendResult = await dialog360.sendTextMessage(creds, phone, message.body_text ?? '', replyExternal);
    }

    return await withTenant(tenantId, async (client) => {
      const { rows: [updated] } = await client.query<WhatsAppMessageRow>(
        `UPDATE whatsapp_messages
            SET status          = 'sent',
                external_id     = $1,
                conversation_id = COALESCE(conversation_id, $2),
                sent_at         = now()
          WHERE id = $3 AND tenant_id = $4
          RETURNING *`,
        [sendResult.external_id, sendResult.conversation_id, whatsappMessageId, tenantId]
      );
      if (updated.communication_id) {
        await client.query(
          `UPDATE communications SET status = 'sent' WHERE id = $1 AND tenant_id = $2`,
          [updated.communication_id, tenantId]
        );
      }
      return updated;
    });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 500);
    await markFailed(tenantId, whatsappMessageId, 'SEND_FAILED', msg);
    throw err;
  }
}

async function markFailed(
  tenantId: string,
  whatsappMessageId: string,
  code: string,
  message: string
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE whatsapp_messages
          SET status        = 'failed',
              error_code    = $1,
              error_message = $2
        WHERE id = $3 AND tenant_id = $4`,
      [code, message, whatsappMessageId, tenantId]
    );
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Status callback handling (delivered / read / failed)
// ───────────────────────────────────────────────────────────────────────────

export async function markStatusUpdate(
  tenantId: string,
  externalId: string,
  status: 'delivered' | 'read' | 'failed',
  timestamps?: { deliveredAt?: string | null; readAt?: string | null },
  errorInfo?: { code?: string | null; message?: string | null }
): Promise<WhatsAppMessageRow | null> {
  return withTenant(tenantId, async (client) => {
    const setClauses: string[] = [`status = $1`];
    const values: unknown[] = [status];
    if (status === 'delivered') {
      setClauses.push(`delivered_at = COALESCE($${values.length + 1}::timestamptz, now())`);
      values.push(timestamps?.deliveredAt ?? null);
    } else if (status === 'read') {
      setClauses.push(`delivered_at = COALESCE(delivered_at, now())`);
      setClauses.push(`read_at = COALESCE($${values.length + 1}::timestamptz, now())`);
      values.push(timestamps?.readAt ?? null);
    } else if (status === 'failed') {
      setClauses.push(`error_code = $${values.length + 1}`);
      values.push(errorInfo?.code ?? null);
      setClauses.push(`error_message = $${values.length + 1}`);
      values.push(errorInfo?.message ?? null);
    }
    values.push(tenantId);
    values.push(externalId);
    const sql =
      `UPDATE whatsapp_messages SET ${setClauses.join(', ')}` +
      ` WHERE tenant_id = $${values.length - 1} AND external_id = $${values.length}` +
      ` RETURNING *`;
    const { rows: [row] } = await client.query<WhatsAppMessageRow>(sql, values);

    if (row?.communication_id) {
      await client.query(
        `UPDATE communications SET status = $1 WHERE id = $2 AND tenant_id = $3`,
        [status, row.communication_id, tenantId]
      );
    }
    return row ?? null;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Listing
// ───────────────────────────────────────────────────────────────────────────

export interface ListFilters {
  candidate_id?: string;
  direction?: 'outbound' | 'inbound';
  status?: WhatsAppMessageRow['status'];
  cursor?: string;
  limit?: number;
}

export async function listMessages(
  tenantId: string,
  filters: ListFilters
): Promise<{ data: WhatsAppMessageRow[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [`tenant_id = $1`];
    const values: unknown[] = [tenantId];
    if (filters.candidate_id) {
      conds.push(`candidate_id = $${values.length + 1}`);
      values.push(filters.candidate_id);
    }
    if (filters.direction) {
      conds.push(`direction = $${values.length + 1}`);
      values.push(filters.direction);
    }
    if (filters.status) {
      conds.push(`status = $${values.length + 1}`);
      values.push(filters.status);
    }
    if (filters.cursor) {
      conds.push(`created_at < $${values.length + 1}`);
      values.push(filters.cursor);
    }
    const sql =
      `SELECT * FROM whatsapp_messages WHERE ${conds.join(' AND ')}` +
      ` ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`;
    const { rows } = await client.query<WhatsAppMessageRow>(sql, values);
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const next_cursor = hasMore ? data[data.length - 1].created_at : null;
    return { data, next_cursor };
  });
}

export async function getMessage(
  tenantId: string,
  messageId: string
): Promise<WhatsAppMessageRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<WhatsAppMessageRow>(
      `SELECT * FROM whatsapp_messages WHERE id = $1 AND tenant_id = $2`,
      [messageId, tenantId]
    );
    if (!row) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Bericht niet gevonden');
    return row;
  });
}

export interface ConversationGroup {
  conversation_id: string;
  candidate_id: string | null;
  message_count: number;
  last_message_at: string;
  messages: WhatsAppMessageRow[];
}

export async function listConversations(
  tenantId: string,
  filters: { candidate_id?: string }
): Promise<{ data: ConversationGroup[] }> {
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [`tenant_id = $1`, `conversation_id IS NOT NULL`];
    const values: unknown[] = [tenantId];
    if (filters.candidate_id) {
      conds.push(`candidate_id = $${values.length + 1}`);
      values.push(filters.candidate_id);
    }
    const { rows } = await client.query<WhatsAppMessageRow>(
      `SELECT * FROM whatsapp_messages WHERE ${conds.join(' AND ')}
         ORDER BY conversation_id, created_at ASC LIMIT 500`,
      values
    );
    const grouped = new Map<string, ConversationGroup>();
    for (const row of rows) {
      if (!row.conversation_id) continue;
      let group = grouped.get(row.conversation_id);
      if (!group) {
        group = {
          conversation_id: row.conversation_id,
          candidate_id: row.candidate_id,
          message_count: 0,
          last_message_at: row.created_at,
          messages: [],
        };
        grouped.set(row.conversation_id, group);
      }
      group.message_count++;
      group.last_message_at = row.created_at;
      group.messages.push(row);
    }
    return { data: Array.from(grouped.values()) };
  });
}

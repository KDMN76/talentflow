import { withTenant } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';
import { recordCommunication } from '../../lib/inboxProjector';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Resend inbound payload — minimaal subset waarop we ons baseren.
 * Resend inbound webhooks streamen de complete e-mail payload als JSON; we
 * pakken alleen wat we nodig hebben en doen geen edge-case parsing.
 *
 * Zie https://resend.com/docs/dashboard/webhooks/event-types voor de bron-format.
 */
export interface ResendInboundPayload {
  type?: string;
  data?: {
    from?: string | { email?: string; name?: string };
    to?: string | string[];
    subject?: string;
    html?: string | null;
    text?: string | null;
    headers?: Record<string, string> & {
      message_id?: string;
      'message-id'?: string;
      in_reply_to?: string;
      'in-reply-to'?: string;
      references?: string;
    };
    /** Top-level alternatieven die Resend soms aanbiedt. */
    message_id?: string;
    in_reply_to?: string;
  };
  /** Soms is data plat in plaats van genest. */
  from?: string | { email?: string; name?: string };
  to?: string | string[];
  subject?: string;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string>;
  message_id?: string;
  in_reply_to?: string;
}

interface ParsedInbound {
  to: string;
  from: string;
  subject: string;
  html: string | null;
  text: string | null;
  messageId: string | null;
  inReplyTo: string | null;
}

interface PlusAddressMatch {
  tenantId: string;
  threadId: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Parseert een plus-addressed reply-adres van de vorm
 *   reply+<tenantId>+<threadId>@<domain>
 * en geeft de UUIDs terug. Geeft null als het adres niet matched.
 */
export function parsePlusAddress(address: string): PlusAddressMatch | null {
  if (!address) return null;
  const local = address.split('@')[0];
  if (!local) return null;
  const parts = local.split('+');
  // ['reply', tenantId, threadId]
  if (parts.length < 3) return null;
  const [, tenantId, threadId] = parts;
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(threadId)) return null;
  return { tenantId, threadId };
}

function flattenAddress(value: ResendInboundPayload['from']): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.email ?? '';
}

function flattenTo(value: ResendInboundPayload['to']): string {
  if (!value) return '';
  if (Array.isArray(value)) return value[0] ?? '';
  return value;
}

function normalize(payload: ResendInboundPayload): ParsedInbound {
  const data = payload.data ?? payload;
  const headers = (data.headers ?? {}) as Record<string, string>;

  const messageId =
    (data as { message_id?: string }).message_id ??
    headers.message_id ??
    headers['message-id'] ??
    null;

  const inReplyTo =
    (data as { in_reply_to?: string }).in_reply_to ??
    headers.in_reply_to ??
    headers['in-reply-to'] ??
    null;

  return {
    to: flattenTo((data as { to?: string | string[] }).to),
    from: flattenAddress((data as { from?: ResendInboundPayload['from'] }).from),
    subject: (data as { subject?: string }).subject ?? '',
    html: (data as { html?: string | null }).html ?? null,
    text: (data as { text?: string | null }).text ?? null,
    messageId,
    inReplyTo,
  };
}

function pickBody(parsed: ParsedInbound): string {
  // We slaan de plain-text op als die er is — anders de HTML-zoals-text.
  // Volledig HTML-parsen valt buiten scope (basic-werkt is genoeg per spec).
  if (parsed.text && parsed.text.trim().length > 0) return parsed.text;
  if (parsed.html) return parsed.html;
  return '';
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Verwerkt een inbound e-mail van Resend en koppelt deze aan een bestaande
 * thread + kandidaat via het plus-addressed To-adres.
 *
 * Best-effort: faalt nooit hard als parsing of DB-write mislukt — logt en
 * returneert een status-object voor de webhook-handler.
 */
export async function handleInboundEmail(
  payload: ResendInboundPayload
): Promise<{ accepted: boolean; reason?: string }> {
  const parsed = normalize(payload);

  if (!parsed.to) {
    logger.warn('[email-inbound] payload zonder "to" — overgeslagen', { payload: parsed });
    return { accepted: false, reason: 'missing_to' };
  }

  const match = parsePlusAddress(parsed.to);
  if (!match) {
    logger.warn('[email-inbound] kon plus-address niet parsen — overgeslagen', { to: parsed.to });
    return { accepted: false, reason: 'invalid_plus_address' };
  }

  try {
    await withTenant(match.tenantId, async (client) => {
      // Vind de thread (RLS zorgt automatisch dat tenant matched).
      const { rows: [thread] } = await client.query<{
        id: string;
        candidate_id: string;
      }>(
        `SELECT id, candidate_id FROM email_threads WHERE id = $1 AND tenant_id = $2`,
        [match.threadId, match.tenantId]
      );

      if (!thread) {
        logger.warn('[email-inbound] thread niet gevonden — bericht genegeerd', {
          tenantId: match.tenantId,
          threadId: match.threadId,
        });
        return;
      }

      const body = pickBody(parsed);

      const { rows: [communication] } = await client.query<{ id: string }>(
        `INSERT INTO communications
           (tenant_id, candidate_id, channel, direction, subject, body, status,
            message_id, in_reply_to, thread_id)
         VALUES ($1, $2, 'email', 'inbound', $3, $4, 'delivered', $5, $6, $7)
         RETURNING id`,
        [
          match.tenantId,
          thread.candidate_id,
          parsed.subject,
          body,
          parsed.messageId,
          parsed.inReplyTo,
          thread.id,
        ]
      );

      await client.query(
        `UPDATE email_threads SET last_message_at = now() WHERE id = $1 AND tenant_id = $2`,
        [thread.id, match.tenantId]
      );

      // Project into unified_threads so inbound e-mail replies show up in
      // the omni-channel inbox (in-transaction, matching voice.service.ts).
      await recordCommunication({
        tenantId: match.tenantId,
        candidateId: thread.candidate_id,
        communicationId: communication.id,
        channel: 'email',
        direction: 'inbound',
        preview: body,
        client,
        suppressEvent: true,
      });

      // Activity log — fire-and-forget.
      client.query(
        `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
         VALUES ($1, 'candidate', $2, NULL, 'email_received', $3)`,
        [
          match.tenantId,
          thread.candidate_id,
          JSON.stringify({
            from: parsed.from,
            subject: parsed.subject,
            thread_id: thread.id,
            message_id: parsed.messageId,
          }),
        ]
      ).catch((actErr: Error) => {
        logger.warn('[email-inbound] activity log insert failed', { error: actErr.message });
      });
    });

    return { accepted: true };
  } catch (err) {
    logger.error('[email-inbound] verwerking gefaald', {
      tenantId: match.tenantId,
      threadId: match.threadId,
      error: (err as Error).message,
    });
    return { accepted: false, reason: 'processing_error' };
  }
}

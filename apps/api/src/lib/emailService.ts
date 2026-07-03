import { Resend } from 'resend';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../middleware/errorHandler';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SendEmailParams {
  to: string;
  /** Optional override; defaults to process.env.RESEND_FROM */
  from?: string;
  /** Reply-To header (used for plus-addressing threading). */
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  /** Resend Message-ID to thread against (sets `In-Reply-To` header). */
  inReplyTo?: string;
  /** Resend Message-IDs for the `References` header. */
  references?: string[];
}

export interface SendEmailResult {
  messageId: string;
  provider: 'resend';
  /** True when no API-key was configured and the send was mocked locally. */
  mocked?: boolean;
}

// ─── Singleton client ───────────────────────────────────────────────────────

let cachedClient: Resend | null = null;

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (cachedClient) return cachedClient;
  cachedClient = new Resend(apiKey);
  return cachedClient;
}

/**
 * Globale afzender ("TalentFlow <no-reply@send.kdmn.nl>"). Exported zodat
 * tenantMailer.ts de display-naam per tenant kan overriden zonder het
 * geverifieerde adres te dupliceren.
 */
export function getDefaultFrom(): string {
  return process.env.RESEND_FROM ?? 'TalentFlow <noreply@talentflow.app>';
}

function defaultFrom(): string {
  return getDefaultFrom();
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Verzendt een e-mail via Resend.
 *
 * Mock-mode: als `RESEND_API_KEY` ontbreekt én `NODE_ENV !== 'production'`,
 * loggen we de e-mail en returneren we een fake messageId `mock_<uuid>`.
 * In production: gooien we een error.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const client = getClient();

  if (!client) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RESEND_API_KEY ontbreekt — kan in production geen e-mail verzenden.');
    }

    const messageId = `mock_${uuidv4()}`;
    logger.info('[emailService] [MOCK] e-mail niet verzonden — RESEND_API_KEY ontbreekt', {
      to: params.to,
      from: params.from ?? defaultFrom(),
      replyTo: params.replyTo,
      subject: params.subject,
      htmlLength: params.html.length,
      textLength: params.text?.length ?? 0,
      inReplyTo: params.inReplyTo,
      references: params.references,
      mockMessageId: messageId,
    });
    return { messageId, provider: 'resend', mocked: true };
  }

  // Bouw optionele headers voor threading.
  const headers: Record<string, string> = {};
  if (params.inReplyTo) headers['In-Reply-To'] = params.inReplyTo;
  if (params.references && params.references.length > 0) {
    headers['References'] = params.references.join(' ');
  }

  const response = await client.emails.send({
    from: params.from ?? defaultFrom(),
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    replyTo: params.replyTo,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });

  if (response.error || !response.data) {
    const errMsg = response.error?.message ?? 'Onbekende Resend-fout';
    throw new Error(`Resend-fout: ${errMsg}`);
  }

  return {
    messageId: response.data.id,
    provider: 'resend',
  };
}

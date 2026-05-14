/**
 * WhatsApp consent service — Sprint Q4.6 (Agent ZZZ).
 *
 * GDPR + EU AI Act: WhatsApp outreach requires explicit candidate consent.
 * We model that with three artefacts:
 *
 *   1. `whatsapp_consents` — current state per (tenant, candidate).
 *   2. `whatsapp_optin_tokens` — single-use signed tokens to drive the
 *      public opt-in landing page.
 *   3. inbound `JA/AKKOORD/YES` keyword detection — recorded as
 *      `opt_in_source = 'reply'` with `opt_in_message_id` linking the proof.
 *
 * Withdrawal flows:
 *   - candidate replies `STOP` / `STOPPEN` inbound → consent withdrawn,
 *     `whatsappConsentWithdrawn` emitted so nurture pauses enrollments.
 *   - recruiter-initiated withdraw via API.
 *
 * All grant + withdraw operations write an audit row.
 */

import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { eventBus } from '../../lib/eventBus';

export interface ConsentRow {
  id: string;
  tenant_id: string;
  candidate_id: string;
  phone_number: string;
  status: 'pending' | 'granted' | 'withdrawn' | 'blocked';
  opt_in_source: 'career_page' | 'recruiter_invite' | 'reply' | 'imported' | null;
  opt_in_message_id: string | null;
  granted_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface OptInTokenRow {
  id: string;
  tenant_id: string;
  candidate_id: string;
  phone_number: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface OperationCtx {
  userId: string;
  auditCtx?: AuditContext;
}

const TOKEN_TTL_HOURS = 72;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a single-use opt-in token, persist its sha256 hash, and return
 * a public URL that the candidate can click to grant consent.
 *
 * Caller is responsible for delivering the URL to the candidate (via
 * utility-template WhatsApp invite, fallback email, SMS, etc).
 */
export interface OptInInviteResult {
  token_url: string;
  token: string;
  expires_at: string;
}

export async function issueOptInInvite(
  tenantId: string,
  candidateId: string,
  phoneNumber: string,
  ctx: OperationCtx
): Promise<OptInInviteResult> {
  if (!phoneNumber.startsWith('+')) {
    throw new AppError(400, 'INVALID_PHONE_NUMBER', 'phone_number moet E.164-formaat zijn');
  }
  const token = crypto.randomBytes(24).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  return withTenant(tenantId, async (client) => {
    // Ensure consent row exists in pending state for visibility.
    await client.query(
      `INSERT INTO whatsapp_consents
         (tenant_id, candidate_id, phone_number, status, opt_in_source)
       VALUES ($1, $2, $3, 'pending', 'recruiter_invite')
       ON CONFLICT (tenant_id, candidate_id) DO UPDATE
         SET phone_number = EXCLUDED.phone_number,
             status       = CASE
               WHEN whatsapp_consents.status = 'granted' THEN whatsapp_consents.status
               ELSE 'pending'
             END,
             opt_in_source = CASE
               WHEN whatsapp_consents.status = 'granted' THEN whatsapp_consents.opt_in_source
               ELSE 'recruiter_invite'
             END`,
      [tenantId, candidateId, phoneNumber]
    );

    await client.query(
      `INSERT INTO whatsapp_optin_tokens
         (tenant_id, candidate_id, phone_number, token_hash, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)`,
      [tenantId, candidateId, phoneNumber, tokenHash, expiresAt.toISOString()]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'whatsapp.consent.invite_issued',
        entityType: 'whatsapp_consent',
        entityId: candidateId,
        userId: ctx.userId,
        after: { phone_number: phoneNumber, expires_at: expiresAt.toISOString() },
      },
      ctx.auditCtx ?? {}
    );

    const baseUrl = process.env.PUBLIC_APP_URL ?? 'https://app.talentflow.eu';
    return {
      token_url: `${baseUrl}/whatsapp/opt-in/${token}`,
      token,
      expires_at: expiresAt.toISOString(),
    };
  });
}

/**
 * Public-flow grant: looks up token by sha256 hash. No tenant context — the
 * token row carries its own tenant_id. Returns null if invalid / expired /
 * already consumed.
 */
export interface PublicTokenLookup {
  tenantId: string;
  candidateId: string;
  phoneNumber: string;
  candidateName: string | null;
}

export async function lookupTokenForPublic(token: string): Promise<PublicTokenLookup | null> {
  const tokenHash = hashToken(token);
  return withoutTenant(async (client) => {
    const { rows: [row] } = await client.query<{
      tenant_id: string;
      candidate_id: string;
      phone_number: string;
      candidate_name: string | null;
      expires_at: string;
      consumed_at: string | null;
    }>(
      `SELECT t.tenant_id, t.candidate_id, t.phone_number,
              c.name AS candidate_name, t.expires_at, t.consumed_at
         FROM whatsapp_optin_tokens t
         LEFT JOIN candidates c ON c.id = t.candidate_id
         WHERE t.token_hash = $1
         LIMIT 1`,
      [tokenHash]
    );
    if (!row) return null;
    if (row.consumed_at) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    return {
      tenantId: row.tenant_id,
      candidateId: row.candidate_id,
      phoneNumber: row.phone_number,
      candidateName: row.candidate_name,
    };
  });
}

export async function grantConsentViaToken(
  token: string,
  ip: string | null,
  userAgent: string | null
): Promise<ConsentRow> {
  const tokenHash = hashToken(token);
  const lookup = await lookupTokenForPublic(token);
  if (!lookup) {
    throw new AppError(404, 'INVALID_TOKEN', 'Token ongeldig, verlopen of al gebruikt');
  }
  return withTenant(lookup.tenantId, async (client) => {
    // Consume the token first so concurrent calls cannot grant twice.
    const { rowCount } = await client.query(
      `UPDATE whatsapp_optin_tokens
          SET consumed_at = now()
        WHERE token_hash = $1
          AND tenant_id  = $2
          AND consumed_at IS NULL
          AND expires_at > now()`,
      [tokenHash, lookup.tenantId]
    );
    if (rowCount === 0) {
      throw new AppError(409, 'INVALID_TOKEN', 'Token is inmiddels gebruikt of verlopen');
    }

    const { rows: [row] } = await client.query<ConsentRow>(
      `INSERT INTO whatsapp_consents
         (tenant_id, candidate_id, phone_number, status, opt_in_source,
          granted_at, ip_address, user_agent)
       VALUES ($1, $2, $3, 'granted', 'career_page', now(), $4, $5)
       ON CONFLICT (tenant_id, candidate_id) DO UPDATE
         SET status        = 'granted',
             granted_at    = now(),
             opt_in_source = 'career_page',
             phone_number  = EXCLUDED.phone_number,
             ip_address    = EXCLUDED.ip_address,
             user_agent    = EXCLUDED.user_agent,
             withdrawn_at  = NULL,
             withdrawal_reason = NULL
       RETURNING *`,
      [lookup.tenantId, lookup.candidateId, lookup.phoneNumber, ip, userAgent]
    );

    await logAudit(
      client,
      lookup.tenantId,
      {
        action: 'whatsapp.consent.granted',
        entityType: 'whatsapp_consent',
        entityId: row.id,
        userId: null,
        after: { phone_number: row.phone_number, source: 'career_page' },
      },
      { ipAddress: ip ?? undefined, userAgent: userAgent ?? undefined }
    );

    eventBus.emit('whatsappConsentGranted', {
      tenantId: lookup.tenantId,
      candidateId: lookup.candidateId,
      phoneNumber: lookup.phoneNumber,
      source: 'career_page',
    });

    return row;
  });
}

/**
 * Internal: candidate replied the opt-in keyword. messageId is the
 * inbound WhatsApp message row id and serves as audit proof.
 */
export async function grantConsentViaReply(
  tenantId: string,
  candidateId: string,
  phoneNumber: string,
  messageId: string
): Promise<ConsentRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<ConsentRow>(
      `INSERT INTO whatsapp_consents
         (tenant_id, candidate_id, phone_number, status, opt_in_source,
          opt_in_message_id, granted_at)
       VALUES ($1, $2, $3, 'granted', 'reply', $4, now())
       ON CONFLICT (tenant_id, candidate_id) DO UPDATE
         SET status            = 'granted',
             opt_in_source     = 'reply',
             opt_in_message_id = EXCLUDED.opt_in_message_id,
             granted_at        = now(),
             phone_number      = EXCLUDED.phone_number,
             withdrawn_at      = NULL,
             withdrawal_reason = NULL
       RETURNING *`,
      [tenantId, candidateId, phoneNumber, messageId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'whatsapp.consent.granted',
        entityType: 'whatsapp_consent',
        entityId: row.id,
        userId: null,
        after: { phone_number: phoneNumber, source: 'reply', message_id: messageId },
      },
      {}
    );
    eventBus.emit('whatsappConsentGranted', {
      tenantId,
      candidateId,
      phoneNumber,
      source: 'reply',
    });
    return row;
  });
}

export async function withdrawConsent(
  tenantId: string,
  candidateId: string,
  reason: string,
  ctx?: OperationCtx
): Promise<ConsentRow> {
  const row = await withTenant(tenantId, async (client) => {
    const { rows: [updated] } = await client.query<ConsentRow>(
      `UPDATE whatsapp_consents
          SET status           = 'withdrawn',
              withdrawn_at     = now(),
              withdrawal_reason = $1
        WHERE tenant_id = $2 AND candidate_id = $3
        RETURNING *`,
      [reason.slice(0, 500), tenantId, candidateId]
    );
    if (!updated) {
      // No consent yet — create a withdrawn row anyway so we record the
      // candidate's preference (e.g. STOP message from someone we never
      // had explicit consent from).
      const { rows: [inserted] } = await client.query<ConsentRow>(
        `INSERT INTO whatsapp_consents
           (tenant_id, candidate_id, phone_number, status, withdrawn_at, withdrawal_reason)
         SELECT $1, $2, COALESCE(c.phone, ''), 'withdrawn', now(), $3
           FROM candidates c WHERE c.id = $2 AND c.tenant_id = $1
         ON CONFLICT (tenant_id, candidate_id) DO UPDATE
           SET status            = 'withdrawn',
               withdrawn_at      = now(),
               withdrawal_reason = EXCLUDED.withdrawal_reason
         RETURNING *`,
        [tenantId, candidateId, reason.slice(0, 500)]
      );
      return inserted;
    }
    return updated;
  });
  if (!row) {
    throw new AppError(404, 'CONSENT_NOT_FOUND', 'Geen consent-record en kandidaat niet gevonden');
  }

  await withTenant(tenantId, async (client) => {
    await logAudit(
      client,
      tenantId,
      {
        action: 'whatsapp.consent.withdrawn',
        entityType: 'whatsapp_consent',
        entityId: row.id,
        userId: ctx?.userId ?? null,
        after: { reason: reason.slice(0, 500) },
      },
      ctx?.auditCtx ?? {}
    );
  });

  eventBus.emit('whatsappConsentWithdrawn', {
    tenantId,
    candidateId,
    reason: reason.slice(0, 500),
  });

  // Also try to pause active nurture enrollments directly — defence in
  // depth: even if there's no subscriber to the eventBus, the explicit
  // call covers the bases. Failures are best-effort logged.
  try {
    const { pauseAllEnrollmentsForCandidate } = await import('../nurture/nurture.service');
    await pauseAllEnrollmentsForCandidate?.(tenantId, candidateId, {
      userId: ctx?.userId ?? null,
      reason: 'whatsapp consent withdrawn',
    });
  } catch (err) {
    logger.warn('[whatsapp.consent] pauseAllEnrollmentsForCandidate unavailable', {
      error: (err as Error).message,
    });
  }

  return row;
}

export async function getConsent(
  tenantId: string,
  candidateId: string
): Promise<ConsentRow | null> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<ConsentRow>(
      `SELECT * FROM whatsapp_consents
         WHERE tenant_id = $1 AND candidate_id = $2
         LIMIT 1`,
      [tenantId, candidateId]
    );
    return row ?? null;
  });
}

export interface ListConsentsFilters {
  status?: ConsentRow['status'];
  cursor?: string;
  limit?: number;
}

export async function listConsents(
  tenantId: string,
  filters: ListConsentsFilters
): Promise<{ data: ConsentRow[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [`tenant_id = $1`];
    const values: unknown[] = [tenantId];
    if (filters.status) {
      conds.push(`status = $${values.length + 1}`);
      values.push(filters.status);
    }
    if (filters.cursor) {
      conds.push(`created_at < $${values.length + 1}`);
      values.push(filters.cursor);
    }
    const sql =
      `SELECT * FROM whatsapp_consents WHERE ${conds.join(' AND ')}` +
      ` ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`;
    const { rows } = await client.query<ConsentRow>(sql, values);
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const next_cursor = hasMore ? data[data.length - 1].created_at : null;
    return { data, next_cursor };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Inbound keyword detection helpers
// ───────────────────────────────────────────────────────────────────────────

const OPT_IN_KEYWORDS = ['JA', 'AKKOORD', 'YES', 'OK', 'AKKOORD!'];
const STOP_KEYWORDS = ['STOP', 'STOPPEN', 'UITSCHRIJVEN', 'UNSUBSCRIBE'];

export function detectOptInKeyword(body: string | null | undefined): boolean {
  if (!body) return false;
  const norm = body.trim().toUpperCase();
  return OPT_IN_KEYWORDS.includes(norm);
}

export function detectStopKeyword(body: string | null | undefined): boolean {
  if (!body) return false;
  const norm = body.trim().toUpperCase();
  return STOP_KEYWORDS.includes(norm);
}

export const __test = { hashToken, TOKEN_TTL_HOURS };

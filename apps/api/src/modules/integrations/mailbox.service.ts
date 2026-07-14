/**
 * Mailbox-integration service — Sprint Q3.1.
 *
 * Verbindt provider-laag (`lib/providers`) met persistence (`mailbox_integrations`
 * tabel) en de rest van de app (audit, communications-INSERT, workflow-events).
 *
 * Tokens worden in MVP **plaintext** opgeslagen. Roadmap: encryptie via
 * pgcrypto's `pgp_sym_encrypt` met env `MAILBOX_TOKEN_ENCRYPTION_KEY`. Alle
 * lookups gaan via `getDecryptedTokens` zodat de upgrade transparant is.
 *
 * OAuth-state wordt **stateless** in Redis bewaard (TTL 10 min) — caller
 * krijgt een `state`-token en de callback-route ruilt 'm in voor tenant/user
 * context. Dit voorkomt session-state op de API en werkt cross-domain.
 */

import { withTenant, withoutTenant } from '../../db/pool';
import { redis } from '../../queue/queues';
import { getMailProvider, isProviderMockMode } from '../../lib/providers';
import { logAudit } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { AppError, logger } from '../../middleware/errorHandler';
import { randomUUID } from 'crypto';
import type { MailProviderName } from '../../lib/mailProvider';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface MailboxIntegration {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: MailProviderName;
  account_email: string;
  account_name: string | null;
  scope: string;
  last_sync_at: string | null;
  /** Aantal inbound e-mails dat de afgelopen 24u via deze mailbox is gesynct. */
  emails_synced_24h: number;
  active: boolean;
  created_at: string;
}

export interface MailboxIntegrationWithTokens extends MailboxIntegration {
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  history_id: string | null;
  sync_error: string | null;
}

interface OAuthStatePayload {
  tenantId: string;
  userId: string;
  provider: MailProviderName;
}

// ─── Public columns (without secrets) ──────────────────────────────────────

const PUBLIC_COLUMNS = `
  id, tenant_id, user_id, provider, account_email, account_name, scope,
  last_sync_at, active, created_at
`;

const FULL_COLUMNS = `
  id, tenant_id, user_id, provider, account_email, account_name, scope,
  access_token, refresh_token, token_expires_at, history_id, sync_error,
  last_sync_at, active, created_at
`;

// ─── Helpers ───────────────────────────────────────────────────────────────

const STATE_REDIS_PREFIX = 'oauth:state:';
const STATE_TTL_SECONDS = 600; // 10 minutes

function isProviderName(s: string): s is MailProviderName {
  return s === 'gmail' || s === 'outlook';
}

// ─── Provider config-status (welke OAuth-providers zijn ingericht) ──────────

export interface ProviderConfigStatus {
  provider: MailProviderName;
  configured: boolean;
}

/**
 * Rapporteert per OAuth-provider of de server-side client-credentials
 * (client-id/secret) gezet zijn — NOOIT de secrets zelf, alleen booleans.
 *
 * `outlook` dekt zowel Outlook.com als Microsoft 365: beide lopen via
 * dezelfde Microsoft-Graph-OAuth (AZURE_AD_CLIENT_ID/SECRET). De frontend
 * gebruikt dit om "Verbind Gmail/Outlook" te disablen zolang de koppeling nog
 * niet is ingericht, i.p.v. de gebruiker naar een kapotte OAuth-URL te sturen.
 */
export function getProviderConfigStatus(): ProviderConfigStatus[] {
  const providers: MailProviderName[] = ['gmail', 'outlook'];
  return providers.map((provider) => ({
    provider,
    configured: !isProviderMockMode(provider),
  }));
}

function rowToPublic(row: MailboxIntegrationWithTokens | MailboxIntegration): MailboxIntegration {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    provider: row.provider,
    account_email: row.account_email,
    account_name: row.account_name,
    scope: row.scope,
    last_sync_at: row.last_sync_at,
    // Net (her)verbonden via de OAuth-callback: er is nog niets gesynct.
    emails_synced_24h: 0,
    active: row.active,
    created_at: row.created_at,
  };
}

// ─── OAuth: start ──────────────────────────────────────────────────────────

export async function startOAuth(
  tenantId: string,
  userId: string,
  provider: MailProviderName
): Promise<{ url: string; state: string }> {
  if (!isProviderName(provider)) {
    throw new AppError(400, 'INVALID_PROVIDER', 'Unsupported mail provider');
  }
  // Eerlijke staat: als de OAuth-client (client-id/secret) ontbreekt, NOOIT een
  // (kapotte/lege) OAuth-URL bouwen. De frontend disablet de knop al op basis
  // van getProviderConfigStatus(); dit is de server-side vangnet voor directe
  // API-calls.
  if (isProviderMockMode(provider)) {
    throw new AppError(
      501,
      'PROVIDER_NOT_CONFIGURED',
      `${provider}-OAuth is nog niet geconfigureerd door de beheerder`
    );
  }
  const state = randomUUID();
  const payload: OAuthStatePayload = { tenantId, userId, provider };

  try {
    await redis.setex(
      `${STATE_REDIS_PREFIX}${state}`,
      STATE_TTL_SECONDS,
      JSON.stringify(payload)
    );
  } catch (err) {
    logger.error('[mailbox.service] failed to persist oauth state in Redis', {
      error: (err as Error).message,
    });
    throw new AppError(503, 'STATE_STORAGE_UNAVAILABLE', 'OAuth-state kon niet bewaard worden');
  }

  const p = getMailProvider(provider);
  const url = p.getAuthUrl(state);
  return { url, state };
}

// ─── OAuth: complete ───────────────────────────────────────────────────────

export async function completeOAuth(code: string, state: string): Promise<MailboxIntegration> {
  const key = `${STATE_REDIS_PREFIX}${state}`;
  let payload: OAuthStatePayload | null = null;
  try {
    const raw = await redis.get(key);
    if (raw) {
      payload = JSON.parse(raw) as OAuthStatePayload;
      // delete-after-use to prevent replay
      await redis.del(key);
    }
  } catch (err) {
    logger.warn('[mailbox.service] redis state lookup failed', {
      error: (err as Error).message,
    });
  }

  if (!payload) {
    throw new AppError(400, 'INVALID_STATE', 'OAuth state ongeldig of verlopen');
  }

  const provider = getMailProvider(payload.provider);
  const tokens = await provider.exchangeCode(code);
  // Profile lookup — providers may already include account info.
  const profile = tokens.account_email
    ? { email: tokens.account_email, name: tokens.account_name }
    : await provider.getProfile(tokens.access_token);

  if (!tokens.refresh_token) {
    throw new AppError(
      400,
      'NO_REFRESH_TOKEN',
      'Provider leverde geen refresh_token (offline_access scope ontbreekt?)'
    );
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  return withTenant(payload.tenantId, async (client) => {
    // Upsert: same (tenant,user,provider,email) reconnect updates tokens.
    const { rows: [row] } = await client.query<MailboxIntegrationWithTokens>(
      `INSERT INTO mailbox_integrations
         (tenant_id, user_id, provider, account_email, account_name,
          access_token, refresh_token, token_expires_at, scope, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
       ON CONFLICT (tenant_id, user_id, provider, account_email)
       DO UPDATE SET
         access_token     = EXCLUDED.access_token,
         refresh_token    = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         scope            = EXCLUDED.scope,
         account_name     = EXCLUDED.account_name,
         active           = TRUE,
         sync_error       = NULL,
         updated_at       = now()
       RETURNING ${FULL_COLUMNS}`,
      [
        payload!.tenantId,
        payload!.userId,
        payload!.provider,
        profile.email,
        profile.name ?? null,
        tokens.access_token,
        tokens.refresh_token,
        expiresAt.toISOString(),
        tokens.scope,
      ]
    );

    await logAudit(client, payload!.tenantId, {
      action: AuditActions.MAILBOX_INTEGRATION_CONNECTED,
      entityType: 'mailbox_integration',
      entityId: row.id,
      userId: payload!.userId,
      after: {
        provider: row.provider,
        account_email: row.account_email,
      },
    });

    return rowToPublic(row);
  });
}

// ─── Listing ───────────────────────────────────────────────────────────────

export async function listIntegrations(
  tenantId: string,
  userId?: string
): Promise<MailboxIntegration[]> {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    let userClause = '';
    if (userId) {
      params.push(userId);
      userClause = `AND user_id = $${params.length}`;
    }
    const { rows } = await client.query<MailboxIntegration>(
      `SELECT ${PUBLIC_COLUMNS},
              COALESCE((
                SELECT count(*)::int
                FROM communications c
                WHERE c.tenant_id = mailbox_integrations.tenant_id
                  AND c.mailbox_integration_id = mailbox_integrations.id
                  AND c.direction = 'inbound'
                  AND c.created_at >= now() - interval '24 hours'
              ), 0) AS emails_synced_24h
       FROM mailbox_integrations
       WHERE tenant_id = $1 ${userClause}
       ORDER BY created_at DESC`,
      params
    );
    return rows;
  });
}

// ─── Disconnect (soft) ─────────────────────────────────────────────────────

export async function disconnectIntegration(
  tenantId: string,
  userId: string,
  integrationId: string
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<{ id: string; account_email: string; provider: string }>(
      `UPDATE mailbox_integrations
       SET active = FALSE, updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, account_email, provider`,
      [integrationId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'INTEGRATION_NOT_FOUND', 'Integratie niet gevonden');
    }
    await logAudit(client, tenantId, {
      action: AuditActions.MAILBOX_INTEGRATION_DISCONNECTED,
      entityType: 'mailbox_integration',
      entityId: row.id,
      userId,
      after: { provider: row.provider, account_email: row.account_email },
    });
  });
}

// ─── Token refresh ─────────────────────────────────────────────────────────

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh als <5min over

export async function refreshTokenIfExpired(
  integration: MailboxIntegrationWithTokens
): Promise<MailboxIntegrationWithTokens> {
  const expiresAt = new Date(integration.token_expires_at).getTime();
  if (expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return integration;
  }

  const provider = getMailProvider(integration.provider);
  let refreshed;
  try {
    refreshed = await provider.refreshAccessToken(integration.refresh_token);
  } catch (err) {
    logger.warn('[mailbox.service] token refresh failed — invalidating integration', {
      integrationId: integration.id,
      provider: integration.provider,
      error: (err as Error).message,
    });
    await invalidateIntegration(
      integration.tenant_id,
      integration.id,
      `Refresh failed: ${(err as Error).message}`
    );
    throw new AppError(401, 'TOKEN_REFRESH_FAILED', 'Provider weigerde refresh-token');
  }

  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  const newRefresh = refreshed.refresh_token ?? integration.refresh_token;

  await withTenant(integration.tenant_id, async (client) => {
    await client.query(
      `UPDATE mailbox_integrations
       SET access_token     = $1,
           refresh_token    = $2,
           token_expires_at = $3,
           scope            = COALESCE($4, scope),
           sync_error       = NULL,
           updated_at       = now()
       WHERE id = $5 AND tenant_id = $6`,
      [
        refreshed.access_token,
        newRefresh,
        newExpiresAt.toISOString(),
        refreshed.scope ?? null,
        integration.id,
        integration.tenant_id,
      ]
    );
    await logAudit(client, integration.tenant_id, {
      action: AuditActions.MAILBOX_INTEGRATION_TOKEN_REFRESHED,
      entityType: 'mailbox_integration',
      entityId: integration.id,
      userId: integration.user_id,
    });
  });

  return {
    ...integration,
    access_token: refreshed.access_token,
    refresh_token: newRefresh,
    token_expires_at: newExpiresAt.toISOString(),
  };
}

// ─── Token decryption helper (MVP: plaintext) ──────────────────────────────

/**
 * Haalt access_token + refresh_token op uit DB.
 *
 * MVP: tokens zijn plaintext in `mailbox_integrations`. In productie zou
 * dit wrapper-pad pgcrypto gebruiken — bv:
 *   `pgp_sym_decrypt(access_token::bytea, $MAILBOX_TOKEN_ENCRYPTION_KEY)`
 * Caller-code blijft identiek.
 */
export async function getDecryptedTokens(
  tenantId: string,
  integrationId: string
): Promise<{ access_token: string; refresh_token: string }> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<{ access_token: string; refresh_token: string }>(
      `SELECT access_token, refresh_token
       FROM mailbox_integrations
       WHERE id = $1 AND tenant_id = $2 AND active = TRUE`,
      [integrationId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'INTEGRATION_NOT_FOUND', 'Integratie niet gevonden of inactief');
    }
    return row;
  });
}

// ─── Full integration loader (used by workers + sendEmailViaIntegration) ───

export async function getIntegrationFull(
  tenantId: string,
  integrationId: string
): Promise<MailboxIntegrationWithTokens> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<MailboxIntegrationWithTokens>(
      `SELECT ${FULL_COLUMNS}
       FROM mailbox_integrations
       WHERE id = $1 AND tenant_id = $2`,
      [integrationId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'INTEGRATION_NOT_FOUND', 'Integratie niet gevonden');
    }
    return row;
  });
}

/**
 * Cross-tenant ophalen — alleen voor de inbox-sync worker (heeft geen
 * tenant-context tot na de lookup). Gebruikt withoutTenant + filter op
 * active = TRUE. Niet exposen naar request-handlers.
 */
export async function listAllActiveIntegrationsForSync(
  limit = 200
): Promise<MailboxIntegrationWithTokens[]> {
  return withoutTenant(async (client) => {
    const { rows } = await client.query<MailboxIntegrationWithTokens>(
      `SELECT ${FULL_COLUMNS}
       FROM mailbox_integrations
       WHERE active = TRUE
       ORDER BY COALESCE(last_sync_at, '1970-01-01') ASC
       LIMIT $1`,
      [limit]
    );
    return rows;
  });
}

// ─── Invalidation (auth-failure) ───────────────────────────────────────────

export async function invalidateIntegration(
  tenantId: string,
  integrationId: string,
  reason: string
): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE mailbox_integrations
         SET active = FALSE, sync_error = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3`,
        [reason.slice(0, 500), integrationId, tenantId]
      );
      await logAudit(client, tenantId, {
        action: AuditActions.MAILBOX_INTEGRATION_INVALIDATED,
        entityType: 'mailbox_integration',
        entityId: integrationId,
        after: { reason },
      });
    });
  } catch (err) {
    logger.error('[mailbox.service] invalidate failed', {
      integrationId,
      error: (err as Error).message,
    });
  }
}

// ─── Send email through a personal mailbox ─────────────────────────────────

export interface SendViaIntegrationParams {
  to: string;
  subject: string;
  html: string;
  threadId?: string;
  inReplyTo?: string;
  candidateId?: string;
}

export async function sendEmailViaIntegration(
  tenantId: string,
  integrationId: string,
  userId: string,
  params: SendViaIntegrationParams
): Promise<{ messageId: string; threadId: string }> {
  // 1) Load + refresh tokens.
  let integration = await getIntegrationFull(tenantId, integrationId);
  if (!integration.active) {
    throw new AppError(409, 'INTEGRATION_INACTIVE', 'Mailbox-integratie is uitgeschakeld');
  }
  integration = await refreshTokenIfExpired(integration);

  // 2) Send via provider.
  const provider = getMailProvider(integration.provider);
  let result;
  try {
    result = await provider.sendEmail(integration.access_token, {
      to: params.to,
      subject: params.subject,
      html: params.html,
      threadId: params.threadId,
      inReplyTo: params.inReplyTo,
    });
  } catch (err) {
    const status = (err as { code?: number; status?: number; statusCode?: number }).statusCode
      ?? (err as { code?: number; status?: number }).status
      ?? (err as { code?: number; status?: number }).code;
    if (status === 401 || status === 403) {
      await invalidateIntegration(tenantId, integration.id, `Send rejected: ${(err as Error).message}`);
    }
    throw err;
  }

  // 3) Record the communication + audit event in one transaction.
  if (params.candidateId) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `INSERT INTO communications
           (tenant_id, candidate_id, channel, direction, subject, body, status,
            message_id, in_reply_to, mailbox_integration_id)
         VALUES ($1, $2, 'email', 'outbound', $3, $4, 'sent', $5, $6, $7)`,
        [
          tenantId,
          params.candidateId,
          params.subject,
          params.html,
          result.messageId,
          params.inReplyTo ?? null,
          integration.id,
        ]
      );
      // Audit only — not bulk-campaign (those have their own action).
      await logAudit(client, tenantId, {
        action: 'communication.email_sent_via_integration',
        entityType: 'communication',
        entityId: result.messageId,
        userId,
        after: {
          provider: integration.provider,
          account_email: integration.account_email,
          to: params.to,
        },
      });
    });
  }

  return result;
}

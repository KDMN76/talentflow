/**
 * WhatsApp Business integration service — Sprint Q4.6 (Agent ZZZ).
 *
 * Owns connect / disconnect / health-check of the per-tenant 360dialog
 * integration. One row per tenant (UNIQUE constraint). Encrypts the API key
 * and webhook secret at rest via `lib/encryption.ts`.
 *
 * The "list" form is kept for API consistency with other module pairs even
 * though there is effectively only ever one row.
 */

import type { PoolClient } from 'pg';
import crypto from 'crypto';
import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { encrypt, decrypt } from '../../lib/encryption';
import * as dialog360 from './connector/dialog360';

export interface WhatsAppIntegrationRow {
  id: string;
  tenant_id: string;
  provider: string;
  status: 'connected' | 'disconnected' | 'suspended' | 'error';
  phone_number: string;
  display_name: string | null;
  api_key_encrypted: Buffer | null;
  waba_id: string | null;
  webhook_secret_encrypted: Buffer | null;
  quality_rating: 'green' | 'yellow' | 'red' | 'unknown';
  messaging_limit: string | null;
  connected_by: string | null;
  connected_at: string | null;
  last_health_check_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PublicIntegration {
  id: string;
  tenant_id: string;
  provider: string;
  status: WhatsAppIntegrationRow['status'];
  phone_number: string;
  display_name: string | null;
  waba_id: string | null;
  quality_rating: WhatsAppIntegrationRow['quality_rating'];
  messaging_limit: string | null;
  connected_by: string | null;
  connected_at: string | null;
  last_health_check_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function toPublic(row: WhatsAppIntegrationRow): PublicIntegration {
  const {
    api_key_encrypted: _k,
    webhook_secret_encrypted: _w,
    ...rest
  } = row;
  return rest;
}

export interface OperationCtx {
  userId: string;
  auditCtx?: AuditContext;
}

export interface ConnectInput {
  phone_number: string;
  api_key: string;
  waba_id?: string | null;
  display_name?: string | null;
  webhook_secret?: string | null;
}

/**
 * Connect or update the tenant's WhatsApp integration. Encrypts the api_key
 * + webhook_secret, performs a health-check against 360dialog, and stores
 * the row with status='connected' if the health-check returns successfully.
 *
 * On health-check failure the row is still saved (status='error', last_error
 * captured) so the recruiter can see why it didn't go through and fix the
 * credentials without re-entering them.
 */
export async function connectIntegration(
  tenantId: string,
  input: ConnectInput,
  ctx: OperationCtx
): Promise<PublicIntegration> {
  // Bevroren feature-guard: in productie zonder live 360dialog-omgeving zou
  // de mock-health-check elke willekeurige key als "verbonden" valideren.
  if (!dialog360.isServiceActive()) {
    throw new AppError(
      503,
      'WHATSAPP_NOT_ENABLED',
      'WhatsApp is niet geactiveerd in deze omgeving. Er kan geen integratie worden gekoppeld.'
    );
  }

  if (!input.phone_number.startsWith('+')) {
    throw new AppError(400, 'INVALID_PHONE_NUMBER', 'phone_number moet E.164-formaat zijn (start met +)');
  }
  if (!input.api_key || input.api_key.length < 8) {
    throw new AppError(400, 'INVALID_API_KEY', 'api_key ontbreekt of is te kort');
  }

  const apiKeyEnc = encrypt(input.api_key);
  const webhookSecret = input.webhook_secret ?? crypto.randomBytes(32).toString('hex');
  const webhookSecretEnc = encrypt(webhookSecret);

  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<WhatsAppIntegrationRow>(
      `INSERT INTO whatsapp_integrations
         (tenant_id, provider, status, phone_number, display_name,
          api_key_encrypted, waba_id, webhook_secret_encrypted,
          connected_by, connected_at, metadata)
       VALUES ($1, '360dialog', 'disconnected', $2, $3, $4, $5, $6, $7, now(), '{}'::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE
         SET phone_number             = EXCLUDED.phone_number,
             display_name             = EXCLUDED.display_name,
             api_key_encrypted        = EXCLUDED.api_key_encrypted,
             waba_id                  = EXCLUDED.waba_id,
             webhook_secret_encrypted = EXCLUDED.webhook_secret_encrypted,
             connected_by             = EXCLUDED.connected_by,
             connected_at             = now()
       RETURNING *`,
      [
        tenantId,
        input.phone_number,
        input.display_name ?? null,
        apiKeyEnc,
        input.waba_id ?? null,
        webhookSecretEnc,
        ctx.userId,
      ]
    );

    // Health-check + finalise status.
    const creds: dialog360.IntegrationCreds = {
      id: row.id,
      tenant_id: tenantId,
      phone_number: row.phone_number,
      waba_id: row.waba_id,
      api_key: input.api_key,
    };

    let nextStatus: WhatsAppIntegrationRow['status'] = 'connected';
    let quality: WhatsAppIntegrationRow['quality_rating'] = 'unknown';
    let messagingLimit: string | null = null;
    let lastError: string | null = null;
    try {
      const info = await dialog360.getAccountInfo(creds);
      quality = info.quality_rating;
      messagingLimit = info.messaging_limit ?? null;
    } catch (err) {
      nextStatus = 'error';
      lastError = (err as Error).message.slice(0, 500);
      logger.warn('[whatsapp.service] health-check failed during connect', {
        tenantId,
        error: lastError,
      });
    }

    const { rows: [updated] } = await client.query<WhatsAppIntegrationRow>(
      `UPDATE whatsapp_integrations
          SET status              = $1,
              quality_rating      = $2,
              messaging_limit     = $3,
              last_health_check_at= now(),
              last_error          = $4
        WHERE id = $5 AND tenant_id = $6
        RETURNING *`,
      [nextStatus, quality, messagingLimit, lastError, row.id, tenantId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'whatsapp.integration.connected',
        entityType: 'whatsapp_integration',
        entityId: updated.id,
        userId: ctx.userId,
        after: { status: updated.status, phone_number: updated.phone_number },
      },
      ctx.auditCtx ?? {}
    );
    return toPublic(updated);
  });
}

export async function disconnectIntegration(
  tenantId: string,
  ctx: OperationCtx
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<{ id: string }>(
      `UPDATE whatsapp_integrations
          SET status = 'disconnected',
              api_key_encrypted = NULL,
              webhook_secret_encrypted = NULL
        WHERE tenant_id = $1
        RETURNING id`,
      [tenantId]
    );
    if (!row) throw new AppError(404, 'INTEGRATION_NOT_FOUND', 'Geen WhatsApp-integratie gevonden');
    await logAudit(
      client,
      tenantId,
      {
        action: 'whatsapp.integration.disconnected',
        entityType: 'whatsapp_integration',
        entityId: row.id,
        userId: ctx.userId,
      },
      ctx.auditCtx ?? {}
    );
  });
}

export async function getIntegration(tenantId: string): Promise<PublicIntegration | null> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<WhatsAppIntegrationRow>(
      `SELECT * FROM whatsapp_integrations WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    return row ? toPublic(row) : null;
  });
}

export async function listIntegrations(tenantId: string): Promise<PublicIntegration[]> {
  const single = await getIntegration(tenantId);
  return single ? [single] : [];
}

/**
 * Load the full integration row (including encrypted blobs) — internal use
 * only by other services that need the decrypted API key for outbound calls
 * or the decrypted webhook secret for HMAC verification.
 */
export async function getIntegrationWithSecrets(
  tenantId: string
): Promise<WhatsAppIntegrationRow | null> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<WhatsAppIntegrationRow>(
      `SELECT * FROM whatsapp_integrations WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    return row ?? null;
  });
}

export async function loadConnectorCreds(
  tenantId: string
): Promise<dialog360.IntegrationCreds> {
  const row = await getIntegrationWithSecrets(tenantId);
  if (!row || !row.api_key_encrypted) {
    throw new AppError(400, 'INTEGRATION_NOT_CONFIGURED', 'WhatsApp-integratie niet geconfigureerd');
  }
  return {
    id: row.id,
    tenant_id: tenantId,
    phone_number: row.phone_number,
    waba_id: row.waba_id,
    api_key: decrypt(row.api_key_encrypted),
  };
}

export async function loadWebhookSecret(tenantId: string): Promise<string | null> {
  const row = await getIntegrationWithSecrets(tenantId);
  if (!row || !row.webhook_secret_encrypted) return null;
  return decrypt(row.webhook_secret_encrypted);
}

export async function healthCheck(
  tenantId: string,
  ctx?: OperationCtx
): Promise<PublicIntegration> {
  // Guard: mock-health-check zou in productie 'connected/green' faken.
  if (!dialog360.isServiceActive()) {
    throw new AppError(
      503,
      'WHATSAPP_NOT_ENABLED',
      'WhatsApp is niet geactiveerd in deze omgeving. Health-check niet mogelijk.'
    );
  }

  const creds = await loadConnectorCreds(tenantId);
  let quality: WhatsAppIntegrationRow['quality_rating'] = 'unknown';
  let messagingLimit: string | null = null;
  let lastError: string | null = null;
  let status: WhatsAppIntegrationRow['status'] = 'connected';
  try {
    const info = await dialog360.getAccountInfo(creds);
    quality = info.quality_rating;
    messagingLimit = info.messaging_limit ?? null;
  } catch (err) {
    status = 'error';
    lastError = (err as Error).message.slice(0, 500);
  }
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<WhatsAppIntegrationRow>(
      `UPDATE whatsapp_integrations
          SET status               = $1,
              quality_rating       = $2,
              messaging_limit      = $3,
              last_health_check_at = now(),
              last_error           = $4
        WHERE tenant_id = $5
        RETURNING *`,
      [status, quality, messagingLimit, lastError, tenantId]
    );
    if (!row) throw new AppError(404, 'INTEGRATION_NOT_FOUND', 'Geen WhatsApp-integratie gevonden');
    if (ctx) {
      await logAudit(
        client,
        tenantId,
        {
          action: 'whatsapp.integration.health_check',
          entityType: 'whatsapp_integration',
          entityId: row.id,
          userId: ctx.userId,
          after: { status: row.status, quality_rating: row.quality_rating },
        },
        ctx.auditCtx ?? {}
      );
    }
    return toPublic(row);
  });
}

/**
 * Look up the tenant for a webhook callback. Webhook URL is
 * `/api/webhooks/whatsapp/:tenantSlug` — we resolve slug → tenant_id by
 * joining the `tenants` table. Public, withoutTenant.
 */
export async function findTenantBySlug(
  slug: string,
  client: PoolClient
): Promise<{ id: string; slug: string } | null> {
  const { rows: [row] } = await client.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM tenants WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  return row ?? null;
}

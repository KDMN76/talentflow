/**
 * Webhook subscription service.
 *
 * Sprint Q4.1 (Agent LLL) — uitgebreid met:
 *   - Tabel-rename: queries gaan tegen `webhook_subscriptions` (canoniek).
 *   - Description-veld + rotateWebhookSecret.
 *
 * DB-fouten propageren naar de globale error-handler (500); geen mock-fallback
 * die een storing als succes maskeert. Bewuste 404/400's blijven AppError-worps.
 *
 * Het delivery-log + retry zijn een aparte service (deliveries.service.ts).
 */

import crypto from 'crypto';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';

export interface Webhook {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  description?: string | null;
  secret: string;
  failure_count?: number;
  last_delivered_at?: string | null;
  last_failure_at?: string | null;
  created_at: string;
}

export interface WebhookLog {
  id: string;
  webhook_id: string;
  event: string;
  status: 'success' | 'failed';
  response_code: number;
  delivered_at: string;
}

export async function listWebhooks(tenantId: string): Promise<Webhook[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, tenant_id, name, description, url, events, active,
              secret, failure_count, last_delivered_at, last_failure_at,
              created_at
       FROM webhook_subscriptions
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [tenantId]
    );
    return rows;
  });
}

export async function createWebhook(
  tenantId: string,
  data: { name: string; url: string; events: string[]; description?: string }
): Promise<Webhook> {
  const secret = crypto.randomBytes(20).toString('hex');

  return withTenant(tenantId, async (client) => {
    const { rows: [webhook] } = await client.query(
      `INSERT INTO webhook_subscriptions (tenant_id, name, description, url, events, secret)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, data.name, data.description ?? null, data.url, data.events, secret]
    );
    return webhook;
  });
}

export async function updateWebhook(
  tenantId: string,
  webhookId: string,
  data: {
    name?: string;
    url?: string;
    events?: string[];
    active?: boolean;
    description?: string;
  }
): Promise<Webhook> {
  return withTenant(tenantId, async (client) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(data.description);
    }
    if (data.url !== undefined) {
      fields.push(`url = $${idx++}`);
      values.push(data.url);
    }
    if (data.events !== undefined) {
      fields.push(`events = $${idx++}`);
      values.push(data.events);
    }
    if (data.active !== undefined) {
      fields.push(`active = $${idx++}`);
      values.push(data.active);
    }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    fields.push(`updated_at = now()`);
    values.push(webhookId, tenantId);

    const { rows: [webhook] } = await client.query(
      `UPDATE webhook_subscriptions
       SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx} AND deleted_at IS NULL
       RETURNING *`,
      values
    );

    if (!webhook) {
      throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook niet gevonden');
    }

    return webhook;
  });
}

export async function deleteWebhook(tenantId: string, webhookId: string): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      const { rows: [webhook] } = await client.query(
        `UPDATE webhook_subscriptions
         SET deleted_at = now()
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [webhookId, tenantId]
      );

      if (!webhook) {
        throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook niet gevonden');
      }
    });
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
  }
}

export async function toggleWebhook(tenantId: string, webhookId: string): Promise<Webhook> {
  return withTenant(tenantId, async (client) => {
    const { rows: [webhook] } = await client.query(
      `UPDATE webhook_subscriptions
       SET active = NOT active, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [webhookId, tenantId]
    );

    if (!webhook) {
      throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook niet gevonden');
    }

    return webhook;
  });
}

export async function rotateWebhookSecret(
  tenantId: string,
  webhookId: string
): Promise<{ id: string; secret: string }> {
  const secret = crypto.randomBytes(20).toString('hex');
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `UPDATE webhook_subscriptions
       SET secret = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
       RETURNING id, secret`,
      [secret, webhookId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook niet gevonden');
    }
    return row as { id: string; secret: string };
  });
}

export async function getWebhookLogs(
  tenantId: string,
  webhookId: string
): Promise<WebhookLog[]> {
  return withTenant(tenantId, async (client) => {
    const { rows: [webhook] } = await client.query(
      `SELECT id FROM webhook_subscriptions
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [webhookId, tenantId]
    );

    if (!webhook) {
      throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook niet gevonden');
    }

    // Map webhook_deliveries → legacy WebhookLog shape voor backwards-compat
    // met de oude /webhooks/:id/logs endpoint.
    const { rows } = await client.query(
      `SELECT id, subscription_id AS webhook_id, event_type AS event,
              CASE WHEN status = 'succeeded' THEN 'success' ELSE 'failed' END AS status,
              COALESCE(response_status, 0) AS response_code,
              COALESCE(delivered_at, created_at) AS delivered_at
       FROM webhook_deliveries
       WHERE subscription_id = $1
       ORDER BY created_at DESC
       LIMIT 25`,
      [webhookId]
    );
    return rows;
  });
}

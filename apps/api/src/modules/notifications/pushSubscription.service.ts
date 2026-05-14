/**
 * Push subscription service — Sprint Q2.4.
 *
 * Beheert per-device push-subscriptions:
 *   - Upsert op endpoint UNIQUE (refresh keys + last_seen_at als bestaat).
 *   - List/Deactivate vanuit het notifications-settings UI.
 *   - Delete-by-endpoint vanuit de push-worker bij een 410 Gone.
 *
 * `device_label` wordt afgeleid uit User-Agent zodat de gebruiker in
 * "Mijn devices" iets herkenbaars ziet ("iPhone 15 — Safari").
 */

import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

export interface PushSubscriptionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
  user_agent: string | null;
  device_label: string | null;
  active: boolean;
  last_seen_at: string;
  created_at: string;
}

export interface CreatePushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

/**
 * Best-effort device-label uit User-Agent. Gebruiken we voor UI alleen —
 * niet voor authentication of routing, dus 100% accuracy is niet kritiek.
 */
export function deriveDeviceLabel(ua: string | undefined | null): string | null {
  if (!ua) return null;
  const u = ua;

  let device = '';
  if (/iPhone/i.test(u)) device = 'iPhone';
  else if (/iPad/i.test(u)) device = 'iPad';
  else if (/Android/i.test(u)) {
    const m = /Android[^;]*;\s*([^;)]+)/i.exec(u);
    device = m ? `Android (${m[1].trim()})` : 'Android';
  } else if (/Macintosh|Mac OS X/i.test(u)) device = 'Mac';
  else if (/Windows/i.test(u)) device = 'Windows';
  else if (/Linux/i.test(u)) device = 'Linux';
  else device = 'Onbekend device';

  let browser = '';
  if (/Edg\//i.test(u)) browser = 'Edge';
  else if (/Chrome\//i.test(u) && !/Edg\//i.test(u)) browser = 'Chrome';
  else if (/Firefox\//i.test(u)) browser = 'Firefox';
  else if (/Safari\//i.test(u) && !/Chrome\//i.test(u)) browser = 'Safari';
  else browser = '';

  return browser ? `${device} — ${browser}` : device;
}

/**
 * Upsert op endpoint UNIQUE. Bij hergebruik (zelfde browser, nieuwe keys
 * na re-subscribe) refreshen we keys + last_seen_at en zetten we active=true.
 */
export async function registerPushSubscription(
  tenantId: string,
  userId: string,
  input: CreatePushSubscriptionInput,
  ctx: AuditContext = {}
): Promise<PushSubscriptionRow> {
  if (!input.endpoint || !input.keys?.p256dh || !input.keys?.auth) {
    throw new AppError(
      400,
      'INVALID_SUBSCRIPTION',
      'Push-subscription mist endpoint of keys'
    );
  }

  const deviceLabel = deriveDeviceLabel(input.userAgent);

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO push_subscriptions
         (tenant_id, user_id, endpoint, keys_p256dh, keys_auth,
          user_agent, device_label, active, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, now())
       ON CONFLICT (endpoint) DO UPDATE SET
         tenant_id    = EXCLUDED.tenant_id,
         user_id      = EXCLUDED.user_id,
         keys_p256dh  = EXCLUDED.keys_p256dh,
         keys_auth    = EXCLUDED.keys_auth,
         user_agent   = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent),
         device_label = COALESCE(EXCLUDED.device_label, push_subscriptions.device_label),
         active       = TRUE,
         last_seen_at = now()
       RETURNING *`,
      [
        tenantId,
        userId,
        input.endpoint,
        input.keys.p256dh,
        input.keys.auth,
        input.userAgent ?? null,
        deviceLabel,
      ]
    );

    const sub = rows[0] as PushSubscriptionRow;

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.PUSH_SUBSCRIPTION_CREATED,
        entityType: 'push_subscription',
        entityId: sub.id,
        after: {
          device_label: sub.device_label,
          endpoint_host: safeHost(sub.endpoint),
        },
        userId,
      },
      ctx
    );

    return sub;
  });
}

export async function listPushSubscriptions(
  tenantId: string,
  userId: string
): Promise<PushSubscriptionRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM push_subscriptions
       WHERE tenant_id = $1 AND user_id = $2 AND active = TRUE
       ORDER BY last_seen_at DESC`,
      [tenantId, userId]
    );
    return rows as PushSubscriptionRow[];
  });
}

/**
 * Used by the worker: list active subscriptions to push to. Returns the
 * minimal shape needed for `sendPushNotification`.
 */
export async function listActiveSubscriptionsForUser(
  tenantId: string,
  userId: string
): Promise<PushSubscriptionRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM push_subscriptions
       WHERE tenant_id = $1 AND user_id = $2 AND active = TRUE`,
      [tenantId, userId]
    );
    return rows as PushSubscriptionRow[];
  });
}

export async function deactivatePushSubscription(
  tenantId: string,
  userId: string,
  subId: string,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `UPDATE push_subscriptions
         SET active = FALSE
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3
       RETURNING *`,
      [subId, tenantId, userId]
    );
    if (rows.length === 0) {
      throw new AppError(
        404,
        'SUBSCRIPTION_NOT_FOUND',
        'Push-subscription niet gevonden'
      );
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.PUSH_SUBSCRIPTION_DELETED,
        entityType: 'push_subscription',
        entityId: subId,
        before: {
          device_label: rows[0].device_label,
          endpoint_host: safeHost(rows[0].endpoint),
        },
        userId,
      },
      ctx
    );
  });
}

/**
 * Worker-cleanup: 410 Gone betekent dat de browser deze sub niet meer kent.
 * We deleten hard zonder tenant-context — de UNIQUE index op endpoint is
 * onze "tenant" hier (één endpoint = één sub). Audit-log slaan we over:
 * dit is een passive cleanup, geen user-action.
 */
export async function deletePushSubscriptionByEndpoint(
  endpoint: string
): Promise<void> {
  return withoutTenant(async (client) => {
    await client.query(
      `DELETE FROM push_subscriptions WHERE endpoint = $1`,
      [endpoint]
    );
  });
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
}

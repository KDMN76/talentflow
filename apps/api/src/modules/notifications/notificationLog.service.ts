/**
 * Notification log — Sprint Q2.4.
 *
 * Append-only delivery-tracking. Wordt vanuit de push-worker gevuld bij
 * iedere job-stap (queued → sent/failed/suppressed_*) en vanuit de
 * service-worker (POST /log/:id/clicked) bij click-tracking.
 *
 * RLS: alle reads via withTenant. Inserts vanuit de worker draaien ook
 * via withTenant zodat tenant_isolation policy actief is.
 */

import { withTenant } from '../../db/pool';
import type { PushPayload } from '../../lib/webPush';

export type NotificationStatus =
  | 'queued'
  | 'sent'
  | 'failed'
  | 'suppressed_quiet'
  | 'suppressed_pref'
  | 'clicked';

export interface NotificationLogRow {
  id: string;
  tenant_id: string;
  user_id: string;
  channel: string;
  event_type: string;
  payload: PushPayload | Record<string, unknown> | null;
  status: NotificationStatus;
  error: string | null;
  delivered_at: string | null;
  clicked_at: string | null;
  created_at: string;
}

export interface InsertLogInput {
  tenantId: string;
  userId: string;
  channel: string;
  eventType: string;
  payload: PushPayload | Record<string, unknown> | null;
  status: NotificationStatus;
  error?: string | null;
}

export async function insertNotificationLog(
  input: InsertLogInput
): Promise<NotificationLogRow> {
  return withTenant(input.tenantId, async (client) => {
    const deliveredAt = input.status === 'sent' ? new Date() : null;
    const { rows } = await client.query(
      `INSERT INTO notification_log
         (tenant_id, user_id, channel, event_type, payload, status, error, delivered_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING *`,
      [
        input.tenantId,
        input.userId,
        input.channel,
        input.eventType,
        input.payload === null ? null : JSON.stringify(input.payload),
        input.status,
        input.error ?? null,
        deliveredAt,
      ]
    );
    return rows[0] as NotificationLogRow;
  });
}

export async function listNotificationLog(
  tenantId: string,
  userId: string,
  limit = 50
): Promise<NotificationLogRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM notification_log
       WHERE tenant_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantId, userId, Math.min(Math.max(limit, 1), 200)]
    );
    return rows as NotificationLogRow[];
  });
}

/**
 * Markeer een notification_log-rij als "clicked". Wordt aangeroepen vanuit
 * de service-worker fetch. Idempotent: meerdere clicks op dezelfde
 * notificatie tellen als één.
 */
export async function markNotificationClicked(
  tenantId: string,
  userId: string,
  logId: string
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE notification_log
         SET clicked_at = COALESCE(clicked_at, now()),
             status = CASE WHEN status = 'sent' THEN 'clicked' ELSE status END
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
      [logId, tenantId, userId]
    );
  });
}

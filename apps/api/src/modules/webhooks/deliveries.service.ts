/**
 * Webhook deliveries service — Sprint Q4.1 (Agent LLL).
 *
 * Verantwoordelijkheden:
 *   - emitWebhookEvent: dispatcht een domain-event naar alle matchende
 *     subscriptions van de tenant (wildcards ondersteund).
 *   - listDeliveries / getDeliveryDetails: admin-UI read-paths.
 *   - retryDelivery: trekt een failed/dead row terug naar pending en
 *     enqueueт een nieuwe BullMQ-job zonder delay.
 *   - deliverWebhook: het écht-versturende deel; wordt door de
 *     webhookDelivery.worker aangeroepen. Berekent HMAC, doet HTTP POST,
 *     update de delivery-row, plant retry of markeert dead.
 *   - matchEventTypes / signPayload: pure helpers (separately tested).
 *
 * Wildcards: een subscription die `candidate.*` listed matched op
 * `candidate.created`, `candidate.updated`, etc. Letterlijk `*` matcht alles.
 *
 * HMAC: header `X-TalentFlow-Signature: sha256=<hex>` met body als input
 * en `subscription.secret` als HMAC-key. Daarnaast `X-TalentFlow-Event`,
 * `X-TalentFlow-Delivery` en `X-TalentFlow-Timestamp` voor extra context.
 *
 * Backoff (in ms): 1m, 5m, 30m, 2h, 6h. Attempt 1 = direct, attempt 2-5
 * gebruiken backoff[attempt-1]. Na attempt 5 zonder succes → status='dead'.
 */

import crypto from 'crypto';
import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { webhookDeliveriesQueue } from '../../queue/queues';

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_ATTEMPTS = 5;

/**
 * Backoff per attempt-number (1-indexed). attempt=1 is initial enqueue
 * (geen delay), attempt=2 wacht 1 minuut, etc.
 *
 * Spec: 1min, 5min, 30min, 2h, 6h.
 */
export const RETRY_BACKOFF_MS: Record<number, number> = {
  1: 0,
  2: 1 * 60 * 1000,
  3: 5 * 60 * 1000,
  4: 30 * 60 * 1000,
  5: 2 * 60 * 60 * 1000,
};

/**
 * Catalogus van event-types die de API kan emiteren. Wordt door
 * /api/webhooks/event-types blootgesteld zodat de admin-UI een multi-select
 * kan tonen. Wildcards (`*` of `<entity>.*`) zijn in de events[] van een
 * subscription toegestaan en worden door matchEventTypes gerespecteerd.
 */
export const KNOWN_EVENT_TYPES: readonly string[] = [
  'candidate.created',
  'candidate.updated',
  'candidate.deleted',
  'candidate.stage_changed',
  'job.created',
  'job.updated',
  'job.filled',
  'job.closed',
  'application.created',
  'application.rejected',
  'application.hired',
  'interview.scheduled',
  'interview.completed',
  'communication.sent',
  'communication.received',
] as const;

// ── Interfaces ───────────────────────────────────────────────────────────────

export type DeliveryStatus = 'pending' | 'delivering' | 'succeeded' | 'failed' | 'dead';

export interface DeliveryRecord {
  id: string;
  subscription_id: string;
  event_type: string;
  event_id: string | null;
  status: DeliveryStatus;
  attempt: number;
  response_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
  delivered_at: string | null;
  next_retry_at: string | null;
}

export interface DeliveryDetail extends DeliveryRecord {
  payload: Record<string, unknown>;
  request_url: string;
  request_headers: Record<string, string> | null;
  request_body: string | null;
  response_headers: Record<string, string> | null;
  response_body: string | null;
}

export interface DeliveryFilters {
  subscription_id?: string;
  event_type?: string;
  status?: DeliveryStatus;
  from?: string; // ISO date
  to?: string;   // ISO date
  limit?: number;
}

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
}

interface DeliveryRow extends DeliveryDetail {
  tenant_id: string;
  secret?: string;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true als `eventType` matcht met de patterns in `subscriptionEvents`.
 *
 * Pattern-syntax:
 *   - `*`              → matcht ALLES
 *   - `entity.*`       → matcht alle events met die prefix
 *   - `entity.action`  → exact match
 */
export function matchEventTypes(
  subscriptionEvents: string[],
  eventType: string
): boolean {
  for (const pattern of subscriptionEvents) {
    if (pattern === '*') return true;
    if (pattern === eventType) return true;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      if (eventType.startsWith(prefix + '.')) return true;
      if (eventType === prefix) return true;
    }
  }
  return false;
}

/**
 * HMAC-SHA256 signature volgens spec:
 *   `sha256=<hex>` met body als input + secret als key.
 *
 * Body wordt UTF-8 encoded. Comparable via crypto.timingSafeEqual op de
 * receiver-kant.
 */
export function signPayload(secret: string, body: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Backoff-ms voor een poging-nummer. attempt=1 → 0 (direct).
 */
export function backoffMs(attempt: number): number {
  return RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[MAX_ATTEMPTS];
}

// ── Read-paths (admin-UI) ────────────────────────────────────────────────────

export async function listDeliveries(
  tenantId: string,
  filters: DeliveryFilters = {}
): Promise<DeliveryRecord[]> {
  const limit = Math.min(filters.limit ?? 100, 500);
  try {
    return await withTenant(tenantId, async (client) => {
      const where: string[] = [`tenant_id = $1`];
      const params: unknown[] = [tenantId];
      let i = 2;

      if (filters.subscription_id) {
        where.push(`subscription_id = $${i++}`);
        params.push(filters.subscription_id);
      }
      if (filters.event_type) {
        where.push(`event_type = $${i++}`);
        params.push(filters.event_type);
      }
      if (filters.status) {
        where.push(`status = $${i++}`);
        params.push(filters.status);
      }
      if (filters.from) {
        where.push(`created_at >= $${i++}`);
        params.push(filters.from);
      }
      if (filters.to) {
        where.push(`created_at <= $${i++}`);
        params.push(filters.to);
      }

      const { rows } = await client.query(
        `SELECT id, subscription_id, event_type, event_id, status, attempt,
                response_status, duration_ms, error_message,
                created_at, delivered_at, next_retry_at
         FROM webhook_deliveries
         WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${i}`,
        [...params, limit]
      );
      return rows as DeliveryRecord[];
    });
  } catch (err) {
    logger.warn('[deliveries.service] listDeliveries failed', {
      tenantId,
      error: (err as Error).message,
    });
    return [];
  }
}

export async function getDeliveryDetails(
  tenantId: string,
  deliveryId: string
): Promise<DeliveryDetail> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT id, subscription_id, event_type, event_id, status, attempt,
              response_status, duration_ms, error_message,
              created_at, delivered_at, next_retry_at,
              payload, request_url, request_headers, request_body,
              response_headers, response_body
       FROM webhook_deliveries
       WHERE id = $1 AND tenant_id = $2`,
      [deliveryId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Delivery niet gevonden');
    }
    return row as DeliveryDetail;
  });
}

// ── Retry / dispatch ─────────────────────────────────────────────────────────

export async function retryDelivery(
  tenantId: string,
  deliveryId: string
): Promise<{ delivery_id: string }> {
  await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `UPDATE webhook_deliveries
       SET status = 'pending',
           attempt = LEAST(attempt + 1, $3),
           next_retry_at = now(),
           error_message = NULL
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [deliveryId, tenantId, MAX_ATTEMPTS]
    );
    if (!row) {
      throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Delivery niet gevonden');
    }
  });

  await webhookDeliveriesQueue.add(
    'deliver',
    { deliveryId, tenantId },
    { jobId: `retry-${deliveryId}-${Date.now()}` }
  );

  return { delivery_id: deliveryId };
}

/**
 * Worker-callable. Doet één delivery-poging en updatet de DB-row.
 * Plant zelf een retry-job in als attempt < MAX_ATTEMPTS.
 */
export async function deliverWebhook(deliveryId: string): Promise<void> {
  // Stap 1: vind tenant + secret + huidige row (zonder RLS — we hebben tenant_id
  // pas na de lookup). Voor de write-path gebruiken we daarna withTenant.
  const meta = await fetchDeliveryMeta(deliveryId);
  if (!meta) {
    logger.warn('[deliverWebhook] delivery niet gevonden — skip', { deliveryId });
    return;
  }
  const { tenantId, subscriptionId, attempt, payload, eventType, url, secret } = meta;

  // Stap 2: markeer 'delivering' (idempotent — als de row al niet pending is, skip).
  const acquired = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `UPDATE webhook_deliveries
       SET status = 'delivering'
       WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
       RETURNING id`,
      [deliveryId, tenantId]
    );
    return rows.length > 0;
  });
  if (!acquired) {
    logger.info('[deliverWebhook] niet pending — skip', { deliveryId });
    return;
  }

  // Stap 3: bouw body + headers + signature.
  const body = JSON.stringify({
    event: eventType,
    delivery_id: deliveryId,
    tenant_id: tenantId,
    timestamp: new Date().toISOString(),
    data: payload,
  });
  const signature = signPayload(secret, body);
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'TalentFlow-Webhook/1.0',
    'X-TalentFlow-Event': eventType,
    'X-TalentFlow-Delivery': deliveryId,
    'X-TalentFlow-Timestamp': new Date().toISOString(),
    'X-TalentFlow-Signature': signature,
  };

  const startedAt = Date.now();
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let responseHeaders: Record<string, string> | null = null;
  let errorMessage: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: requestHeaders,
        body,
        signal: controller.signal,
      });
      responseStatus = res.status;
      responseHeaders = Object.fromEntries(res.headers.entries());
      // Truncate body to 64KB to avoid blowing up the row.
      const text = await res.text();
      responseBody = text.length > 65_536 ? text.slice(0, 65_536) + '…[truncated]' : text;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    errorMessage = (err as Error).message ?? 'unknown delivery error';
  }

  const durationMs = Date.now() - startedAt;
  const succeeded = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;

  // Stap 4: persist outcome + plan retry (of dead).
  await withTenant(tenantId, async (client) => {
    if (succeeded) {
      await client.query(
        `UPDATE webhook_deliveries
         SET status = 'succeeded',
             response_status = $2,
             response_headers = $3,
             response_body = $4,
             request_headers = $5,
             request_body = $6,
             duration_ms = $7,
             delivered_at = now(),
             error_message = NULL,
             next_retry_at = NULL
         WHERE id = $1`,
        [
          deliveryId,
          responseStatus,
          responseHeaders ? JSON.stringify(responseHeaders) : null,
          responseBody,
          JSON.stringify(redactHeaders(requestHeaders)),
          body,
          durationMs,
        ]
      );
      // Reset failure_count + bump last_delivered_at.
      await client.query(
        `UPDATE webhook_subscriptions
         SET failure_count = 0,
             last_delivered_at = now(),
             updated_at = now()
         WHERE id = $1 AND tenant_id = $2`,
        [subscriptionId, tenantId]
      );
      return;
    }

    // Failure path. De oorspronkelijke rij markeren we als 'failed' (niet
    // 'pending'): scheduleRetryDelivery maakt een aparte pending-rij aan voor
    // de volgende poging. Zou de origin op 'pending' blijven staan, dan bleef
    // hij eeuwig hangen (nooit door de worker opgepakt) én was de retry-knop
    // onbereikbaar (die toont alleen bij failed/dead).
    const isDead = attempt >= MAX_ATTEMPTS;
    const newStatus: DeliveryStatus = isDead ? 'dead' : 'failed';
    const nextRetry = isDead ? null : new Date(Date.now() + backoffMs(attempt + 1));

    await client.query(
      `UPDATE webhook_deliveries
       SET status = $2,
           response_status = $3,
           response_headers = $4,
           response_body = $5,
           request_headers = $6,
           request_body = $7,
           duration_ms = $8,
           error_message = $9,
           next_retry_at = $10
       WHERE id = $1`,
      [
        deliveryId,
        newStatus,
        responseStatus,
        responseHeaders ? JSON.stringify(responseHeaders) : null,
        responseBody,
        JSON.stringify(redactHeaders(requestHeaders)),
        body,
        durationMs,
        errorMessage ?? `HTTP ${responseStatus ?? '?'}`,
        nextRetry,
      ]
    );

    await client.query(
      `UPDATE webhook_subscriptions
       SET failure_count = failure_count + 1,
           last_failure_at = now(),
           updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [subscriptionId, tenantId]
    );

    if (isDead) {
      // Audit-event WEBHOOK_DEAD — best-effort, niet kritiek voor de delivery-flow.
      try {
        await client.query(
          `INSERT INTO audit_events (tenant_id, action, entity_type, entity_id, after)
           VALUES ($1, 'WEBHOOK_DEAD', 'webhook_delivery', $2, $3)`,
          [tenantId, deliveryId, JSON.stringify({ subscription_id: subscriptionId, event_type: eventType })]
        );
      } catch (e) {
        logger.warn('[deliverWebhook] audit_events insert failed', {
          deliveryId,
          error: (e as Error).message,
        });
      }
    }
  });

  // Stap 5: enqueue retry buiten de transactie.
  if (!succeeded && attempt < MAX_ATTEMPTS) {
    const delay = backoffMs(attempt + 1);
    // We bumpen attempt-counter pas wanneer de NIEUWE poging start. We slaan
    // een nieuwe row aan met attempt+1 zodat elk attempt zijn eigen log heeft.
    await scheduleRetryDelivery(tenantId, deliveryId, attempt + 1, delay);
  }
}

/**
 * Maakt een nieuwe pending delivery-row aan voor een retry én enqueue die.
 * We nemen request-context (subscription, payload, url) over van de
 * bestaande row zodat retry-attempts identiek blijven aan de eerste poging.
 */
async function scheduleRetryDelivery(
  tenantId: string,
  originalDeliveryId: string,
  nextAttempt: number,
  delayMs: number
): Promise<void> {
  const newId = await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `INSERT INTO webhook_deliveries
         (tenant_id, subscription_id, event_type, event_id, payload,
          request_url, attempt, status, next_retry_at)
       SELECT tenant_id, subscription_id, event_type, event_id, payload,
              request_url, $2, 'pending', now() + ($3 || ' milliseconds')::interval
       FROM webhook_deliveries
       WHERE id = $1 AND tenant_id = $4
       RETURNING id`,
      [originalDeliveryId, nextAttempt, String(delayMs), tenantId]
    );
    return row?.id as string | undefined;
  });

  if (!newId) {
    logger.warn('[deliverWebhook] kon retry niet inplannen — origin row niet gevonden', {
      originalDeliveryId,
    });
    return;
  }

  await webhookDeliveriesQueue.add(
    'deliver',
    { deliveryId: newId, tenantId },
    { delay: delayMs, jobId: `del-${newId}` }
  );
}

interface DeliveryMeta {
  tenantId: string;
  subscriptionId: string;
  attempt: number;
  payload: Record<string, unknown>;
  eventType: string;
  url: string;
  secret: string;
}

/**
 * Lookup zonder RLS (deliveryId is een UUID — niet guessable). Gebruikt door
 * de worker om tenantId vóór het zetten van app.tenant_id te vinden.
 */
async function fetchDeliveryMeta(deliveryId: string): Promise<DeliveryMeta | null> {
  // We gebruiken withTenant niet hier: de worker heeft nog geen tenant-context.
  // Direct via pool met een gebonden query is veilig — alleen interne callers.
  const { pool } = await import('../../db/pool');
  const client = await pool.connect();
  try {
    const { rows: [row] } = await client.query(
      `SELECT d.tenant_id, d.subscription_id, d.attempt, d.payload, d.event_type,
              d.request_url AS url, s.secret
       FROM webhook_deliveries d
       JOIN webhook_subscriptions s ON s.id = d.subscription_id
       WHERE d.id = $1`,
      [deliveryId]
    );
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      subscriptionId: row.subscription_id,
      attempt: row.attempt,
      payload: row.payload,
      eventType: row.event_type,
      url: row.url,
      secret: row.secret,
    };
  } finally {
    client.release();
  }
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  // Signature mag in de log blijven (die zit ook bij de receiver). Geen Authorization
  // headers aanwezig — voor toekomstige extensies redacten we ze toch.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'authorization') {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Emit-path ────────────────────────────────────────────────────────────────

/**
 * Dispatch een domain-event naar alle matchende active subscriptions.
 *
 * Workflow:
 *   1. SELECT alle active subs van tenant.
 *   2. Filter op matchEventTypes(sub.events, eventType).
 *   3. Voor elke match: INSERT pending delivery + enqueue worker-job.
 *
 * Failure-isolated: als één sub faalt logt het een warning maar de andere
 * worden nog steeds verwerkt. We mogen NOOIT het callerverzoek breken
 * vanwege een misbroken webhook-config.
 */
export async function emitWebhookEvent(
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
  options: { entityId?: string } = {}
): Promise<void> {
  let subscriptions: SubscriptionRow[] = [];
  try {
    subscriptions = await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, tenant_id, url, secret, events, active
         FROM webhook_subscriptions
         WHERE tenant_id = $1 AND active = TRUE AND deleted_at IS NULL`,
        [tenantId]
      );
      return rows as SubscriptionRow[];
    });
  } catch (err) {
    logger.warn('[emitWebhookEvent] subscription fetch failed', {
      tenantId,
      eventType,
      error: (err as Error).message,
    });
    return;
  }

  const matching = subscriptions.filter((s) => matchEventTypes(s.events, eventType));
  if (matching.length === 0) {
    return;
  }

  for (const sub of matching) {
    try {
      const deliveryId = await withTenant(tenantId, async (client) => {
        const { rows: [row] } = await client.query(
          `INSERT INTO webhook_deliveries
             (tenant_id, subscription_id, event_type, event_id, payload,
              request_url, attempt, status, next_retry_at)
           VALUES ($1, $2, $3, $4, $5, $6, 1, 'pending', now())
           RETURNING id`,
          [
            tenantId,
            sub.id,
            eventType,
            options.entityId ?? null,
            JSON.stringify(payload),
            sub.url,
          ]
        );
        return row.id as string;
      });

      await webhookDeliveriesQueue.add(
        'deliver',
        { deliveryId, tenantId },
        { jobId: `del-${deliveryId}` }
      );
    } catch (err) {
      logger.warn('[emitWebhookEvent] dispatch failed for subscription', {
        tenantId,
        subscriptionId: sub.id,
        eventType,
        error: (err as Error).message,
      });
    }
  }
}

/**
 * Test-delivery: ad-hoc HTTP-POST naar een willekeurige URL met een sample
 * payload. Maakt GEEN row aan in webhook_deliveries — alleen voor debugging
 * vanuit de admin-UI. Gebruikt een wegwerp-secret zodat de receiver de
 * signature kan verifiëren.
 */
export async function deliverTestEvent(
  url: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<{
  status: number | null;
  duration_ms: number;
  error: string | null;
  signature: string;
  response_body: string | null;
}> {
  const secret = crypto.randomBytes(20).toString('hex');
  const body = JSON.stringify({
    event: eventType,
    delivery_id: `test-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    data: payload,
    test: true,
  });
  const signature = signPayload(secret, body);
  const start = Date.now();
  let status: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TalentFlow-Event': eventType,
          'X-TalentFlow-Signature': signature,
          'X-TalentFlow-Test': 'true',
        },
        body,
        signal: controller.signal,
      });
      status = res.status;
      const text = await res.text();
      responseBody = text.length > 8192 ? text.slice(0, 8192) + '…[truncated]' : text;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    error = (err as Error).message;
  }
  return {
    status,
    duration_ms: Date.now() - start,
    error,
    signature,
    response_body: responseBody,
  };
}

/* eslint-disable @typescript-eslint/no-unused-vars */
type _unused = DeliveryRow;
/* eslint-enable */

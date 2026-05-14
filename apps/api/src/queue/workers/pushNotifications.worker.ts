/**
 * Push-notifications worker — Sprint Q2.4.
 *
 * Per-job verwerking:
 *   1. Check `getEffectivePreference(channel='push', eventType)`.
 *      - !enabled  → log status='suppressed_pref' en stop.
 *      - quietNow  → log status='suppressed_quiet' en reschedule de job
 *                     met delay tot einde quiet-window.
 *   2. List actieve push-subscriptions voor user.
 *   3. Verstuur via `sendPushNotification` per sub.
 *      - expired (410/404) → `deletePushSubscriptionByEndpoint`.
 *      - success/failure   → log per attempt naar `notification_log`.
 *
 * Worker draait inline (dev) en in dedicated container (prod). Volgt
 * dezelfde WORKER_PROCESS / DISABLE_INLINE_WORKERS guards als andere
 * workers in deze codebase.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { pushNotificationsQueue } from '../queues';
import {
  sendPushNotification,
  type PushPayload,
} from '../../lib/webPush';
import {
  listActiveSubscriptionsForUser,
  deletePushSubscriptionByEndpoint,
} from '../../modules/notifications/pushSubscription.service';
import { getEffectivePreference } from '../../modules/notifications/preferences.service';
import { insertNotificationLog } from '../../modules/notifications/notificationLog.service';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export interface PushJobData {
  tenantId: string;
  userId: string;
  eventType: string;
  payload: PushPayload;
  /** Internal: number of times we've rescheduled for quiet-hours. */
  _quietRetries?: number;
}

interface PushJobResult {
  status:
    | 'sent'
    | 'partial'
    | 'failed'
    | 'suppressed_pref'
    | 'suppressed_quiet'
    | 'no_subscriptions';
  delivered: number;
  failed: number;
  expired: number;
}

/**
 * Helper voor andere services om een push-event te enqueuen.
 *
 * In test-mode is BullMQ ge-mocked en doet `add()` niets — dat is prima,
 * de tests verifiëren dan dat de helper correct wordt aangeroepen.
 */
export async function enqueuePush(
  tenantId: string,
  userId: string,
  eventType: string,
  payload: PushPayload
): Promise<void> {
  try {
    await pushNotificationsQueue.add(
      `push:${eventType}:${userId}`,
      { tenantId, userId, eventType, payload } as PushJobData,
      {
        // Collision-tag → BullMQ jobId-dedup binnen kort venster zou
        // dubbele pushes voor dezelfde trigger voorkomen, maar we willen
        // niet jobIds hardcoden (events kunnen vaker terecht komen).
        // Default: gewoon enqueuen.
      }
    );
  } catch (err) {
    // Worker-down mag de caller-flow nooit breken. Log + door.
    logger.error('[pushNotifications] enqueue failed', {
      eventType,
      userId,
      error: (err as Error).message,
    });
  }
}

async function processPushJob(job: Job<PushJobData>): Promise<PushJobResult> {
  const { tenantId, userId, eventType, payload } = job.data;
  const result: PushJobResult = {
    status: 'sent',
    delivered: 0,
    failed: 0,
    expired: 0,
  };

  // 1) Check preference + quiet-hours.
  const pref = await getEffectivePreference(tenantId, userId, 'push', eventType);

  if (!pref.enabled) {
    await safeLog({
      tenantId,
      userId,
      channel: 'push',
      eventType,
      payload,
      status: 'suppressed_pref',
    });
    result.status = 'suppressed_pref';
    return result;
  }

  if (pref.quietNow) {
    await safeLog({
      tenantId,
      userId,
      channel: 'push',
      eventType,
      payload,
      status: 'suppressed_quiet',
    });

    // Reschedule met delay tot einde quiet-window. Cap op 3 retries om
    // accidenteel oneindig opnieuw enqueuen te voorkomen.
    const retries = (job.data._quietRetries ?? 0) + 1;
    if (retries <= 3 && pref.quietEndsAtUtc) {
      const delayMs = Math.max(
        new Date(pref.quietEndsAtUtc).getTime() - Date.now(),
        60_000 // minimaal 1min — voorkomt off-by-one busy-loop
      );
      await pushNotificationsQueue.add(
        `push:${eventType}:${userId}:quiet-retry-${retries}`,
        {
          tenantId,
          userId,
          eventType,
          payload,
          _quietRetries: retries,
        } as PushJobData,
        { delay: delayMs }
      );
      logger.info('[pushNotifications] rescheduled past quiet-hours', {
        userId,
        eventType,
        delayMs,
        retries,
      });
    }

    result.status = 'suppressed_quiet';
    return result;
  }

  // 2) List subs.
  const subs = await listActiveSubscriptionsForUser(tenantId, userId);
  if (subs.length === 0) {
    result.status = 'no_subscriptions';
    return result;
  }

  // 3) Send + log per sub.
  for (const sub of subs) {
    const sendResult = await sendPushNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
      },
      payload
    );

    if (sendResult.success) {
      result.delivered += 1;
      await safeLog({
        tenantId,
        userId,
        channel: 'push',
        eventType,
        payload,
        status: 'sent',
      });
    } else if (sendResult.expired) {
      result.expired += 1;
      try {
        await deletePushSubscriptionByEndpoint(sub.endpoint);
      } catch (err) {
        logger.error('[pushNotifications] cleanup expired sub failed', {
          subId: sub.id,
          error: (err as Error).message,
        });
      }
      await safeLog({
        tenantId,
        userId,
        channel: 'push',
        eventType,
        payload,
        status: 'failed',
        error: `expired (${sendResult.statusCode ?? 410})`,
      });
    } else {
      result.failed += 1;
      await safeLog({
        tenantId,
        userId,
        channel: 'push',
        eventType,
        payload,
        status: 'failed',
        error: sendResult.error ?? 'unknown error',
      });
    }
  }

  if (result.delivered > 0 && result.failed === 0 && result.expired === 0) {
    result.status = 'sent';
  } else if (result.delivered > 0) {
    result.status = 'partial';
  } else {
    result.status = 'failed';
  }
  return result;
}

async function safeLog(
  input: Parameters<typeof insertNotificationLog>[0]
): Promise<void> {
  try {
    await insertNotificationLog(input);
  } catch (err) {
    logger.error('[pushNotifications] log insert failed', {
      eventType: input.eventType,
      status: input.status,
      error: (err as Error).message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker setup — volgt het patroon van retention.worker.ts.
// ─────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let pushWorker: Worker<PushJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[pushNotifications] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  pushWorker = new Worker<PushJobData>('push-notifications', processPushJob, {
    connection,
  });

  pushWorker.on('completed', (job, result) => {
    logger.info('[pushNotifications] Job completed', {
      jobId: job.id,
      status: (result as PushJobResult)?.status,
      delivered: (result as PushJobResult)?.delivered,
    });
  });

  pushWorker.on('failed', (job, err) => {
    logger.error('[pushNotifications] Job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });
}

export { pushWorker, processPushJob };

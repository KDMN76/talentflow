/**
 * Webhook delivery worker — Sprint Q4.1 (Agent LLL).
 *
 * Verwerkt jobs op de `webhook-deliveries` queue. Eén job = één
 * delivery-attempt; de service-laag (deliveries.service.ts) bewaart de
 * volledige attempt-state in `webhook_deliveries` en plant zelf retries
 * met de juiste backoff.
 *
 * BullMQ.attempts staat op 1 (zie queues.ts) zodat onze attempt-counter
 * in de DB de single source of truth is — anders zou BullMQ ook gaan
 * retryen en uit de pas lopen met de DB.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { deliverWebhook } from '../../modules/webhooks/deliveries.service';

interface WebhookDeliveryJobData {
  deliveryId: string;
  tenantId: string;
}

async function processDeliveryJob(job: Job<WebhookDeliveryJobData>): Promise<void> {
  const { deliveryId, tenantId } = job.data ?? {};
  if (!deliveryId || !tenantId) {
    logger.error('[webhookDelivery] invalide job-payload — drop', {
      jobId: job.id,
      data: job.data,
    });
    return;
  }
  logger.info('[webhookDelivery] start', { jobId: job.id, deliveryId, tenantId });
  try {
    await deliverWebhook(deliveryId);
  } catch (err) {
    // deliverWebhook vangt zijn eigen errors af, maar voor de zekerheid:
    logger.error('[webhookDelivery] unexpected error', {
      jobId: job.id,
      deliveryId,
      error: (err as Error).message,
    });
  }
}

// ── Worker setup ──────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let webhookDeliveryWorker: Worker<WebhookDeliveryJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[webhookDelivery] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  webhookDeliveryWorker = new Worker<WebhookDeliveryJobData>(
    'webhook-deliveries',
    processDeliveryJob,
    {
      connection,
      // Concurrency 5: webhooks zijn IO-bound (HTTP-POST), maar we willen
      // niet één tenant het queue laten dichtslibben. 5 parallel is een
      // veilige sweet-spot — schaalt verder via meer worker-replicas.
      concurrency: 5,
    }
  );

  webhookDeliveryWorker.on('completed', (job) => {
    logger.info('[webhookDelivery] job completed', { jobId: job.id });
  });

  webhookDeliveryWorker.on('failed', (job, err) => {
    logger.error('[webhookDelivery] job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });
}

export { webhookDeliveryWorker };

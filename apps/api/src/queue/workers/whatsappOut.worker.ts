/**
 * WhatsApp outbound worker — Sprint Q4.6 (Agent ZZZ).
 *
 * Job-type: `send-whatsapp`. Payload: `{ tenantId, whatsappMessageId }`.
 *
 * Thin wrapper around `messaging.service.dispatchOutboundSend`. All the
 * status-update + audit-log logic lives in the service so retries observe
 * the same invariants.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { dispatchOutboundSend } from '../../modules/whatsapp/messaging.service';

interface JobData {
  tenantId: string;
  whatsappMessageId: string;
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function processJob(job: Job<JobData>): Promise<unknown> {
  const { tenantId, whatsappMessageId } = job.data;
  logger.info('[whatsappOut] processing', { jobId: job.id, whatsappMessageId });
  try {
    const row = await dispatchOutboundSend(tenantId, whatsappMessageId);
    logger.info('[whatsappOut] sent', {
      whatsappMessageId,
      external_id: row.external_id,
    });
    return { status: row.status, external_id: row.external_id };
  } catch (err) {
    logger.error('[whatsappOut] send failed', {
      whatsappMessageId,
      error: (err as Error).message,
    });
    throw err;
  }
}

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let whatsappOutWorker: Worker<JobData> | null = null;

if (!shouldStartWorker) {
  logger.info('[whatsappOut] inline worker disabled');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  whatsappOutWorker = new Worker<JobData>('whatsapp-out', processJob, { connection });
  whatsappOutWorker.on('completed', (job) =>
    logger.info('[whatsappOut] completed', { jobId: job.id })
  );
  whatsappOutWorker.on('failed', (job, err) =>
    logger.error('[whatsappOut] failed', {
      jobId: job?.id,
      error: err.message,
    })
  );
}

export { whatsappOutWorker };

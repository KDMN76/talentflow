/**
 * Accounting payment-pull worker — Sprint Q4.4 (Agent UUU).
 *
 * Periodic cron (elke 30 min): voor elke gesync'de invoice met provider-id
 * vraag de connector of upstream "betaald" zegt. Markeer dan paid_date in
 * onze DB. Per-tenant withTenant + per-invoice try/catch.
 */

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { logger } from '../../middleware/errorHandler';
import { pullPaymentsForAllTenants } from '../../modules/accounting/accounting.service';

const QUEUE_NAME = 'accounting-sync';

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let accountingSyncWorker: Worker | null = null;
let accountingSyncQueue: Queue | null = null;

async function processSyncJob(_job: Job): Promise<unknown> {
  const result = await pullPaymentsForAllTenants();
  logger.info('[accounting] payment-pull cron', result);
  return result;
}

if (!shouldStartWorker) {
  logger.info(
    '[accounting] inline accounting-sync worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    { maxRetriesPerRequest: null, enableReadyCheck: false }
  );
  accountingSyncWorker = new Worker(QUEUE_NAME, processSyncJob, {
    connection,
  });
  accountingSyncWorker.on('failed', (job, err) => {
    logger.error('[accounting] payment-pull cron failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  accountingSyncQueue = new Queue(QUEUE_NAME, {
    connection: new IORedis(
      process.env.REDIS_URL ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: null, enableReadyCheck: false }
    ),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  });
  accountingSyncQueue
    .add(
      'scheduler',
      { scheduler: true },
      {
        repeat: { every: 30 * 60 * 1000 },
        jobId: 'accounting-sync-scheduler',
      }
    )
    .catch((err) => {
      logger.error('[accounting] failed to register sync scheduler', {
        error: (err as Error).message,
      });
    });
}

export { accountingSyncWorker, accountingSyncQueue, processSyncJob };

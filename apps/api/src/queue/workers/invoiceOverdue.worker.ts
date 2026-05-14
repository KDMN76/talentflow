/**
 * Invoice-overdue worker — Sprint Q4.4 (Agent UUU).
 *
 * Daily cron: scan cross-tenant invoices in `sent`-status met `due_date <
 * today` en flip ze naar `overdue`. Geen retries — als de cron-tick faalt,
 * pakt de volgende tick het op.
 */

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { logger } from '../../middleware/errorHandler';
import { markOverdueDueDate } from '../../modules/billing/invoicing.service';

const QUEUE_NAME = 'invoice-overdue';

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let invoiceOverdueWorker: Worker | null = null;
let invoiceOverdueQueue: Queue | null = null;

async function processOverdueJob(_job: Job): Promise<unknown> {
  const result = await markOverdueDueDate();
  logger.info('[billing] invoice-overdue cron', result);
  return result;
}

if (!shouldStartWorker) {
  logger.info(
    '[billing] inline invoice-overdue worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    { maxRetriesPerRequest: null, enableReadyCheck: false }
  );
  invoiceOverdueWorker = new Worker(QUEUE_NAME, processOverdueJob, {
    connection,
  });
  invoiceOverdueWorker.on('failed', (job, err) => {
    logger.error('[billing] invoice-overdue cron failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  // Repeatable scheduler — 1× per dag om 03:00 UTC.
  invoiceOverdueQueue = new Queue(QUEUE_NAME, {
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
  invoiceOverdueQueue
    .add(
      'scheduler',
      { scheduler: true },
      {
        repeat: { pattern: '0 3 * * *' },
        jobId: 'invoice-overdue-scheduler',
      }
    )
    .catch((err) => {
      logger.error('[billing] failed to register overdue scheduler', {
        error: (err as Error).message,
      });
    });
}

export { invoiceOverdueWorker, invoiceOverdueQueue, processOverdueJob };

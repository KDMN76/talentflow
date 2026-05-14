/**
 * Forecast-snapshot worker — Sprint Q4.4 (Agent UUU).
 *
 * Nightly cron (02:30 UTC): per tenant `computeForecast(tenantId, 6)` →
 * UPSERT in `revenue_forecasts`. Per-tenant try/catch isoleert failures.
 */

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { logger } from '../../middleware/errorHandler';
import { computeForecastForAllTenants } from '../../modules/forecasting/forecasting.service';

const QUEUE_NAME = 'forecast-snapshot';

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let forecastSnapshotWorker: Worker | null = null;
let forecastSnapshotQueue: Queue | null = null;

async function processForecastJob(_job: Job): Promise<unknown> {
  const result = await computeForecastForAllTenants(6);
  logger.info('[forecasting] nightly forecast cron', result);
  return result;
}

if (!shouldStartWorker) {
  logger.info(
    '[forecasting] inline forecast-snapshot worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    { maxRetriesPerRequest: null, enableReadyCheck: false }
  );
  forecastSnapshotWorker = new Worker(QUEUE_NAME, processForecastJob, {
    connection,
  });
  forecastSnapshotWorker.on('failed', (job, err) => {
    logger.error('[forecasting] nightly forecast cron failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  forecastSnapshotQueue = new Queue(QUEUE_NAME, {
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
  forecastSnapshotQueue
    .add(
      'scheduler',
      { scheduler: true },
      {
        repeat: { pattern: '30 2 * * *' },
        jobId: 'forecast-snapshot-scheduler',
      }
    )
    .catch((err) => {
      logger.error('[forecasting] failed to register forecast scheduler', {
        error: (err as Error).message,
      });
    });
}

export { forecastSnapshotWorker, forecastSnapshotQueue, processForecastJob };

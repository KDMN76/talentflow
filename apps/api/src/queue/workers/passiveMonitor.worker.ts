/**
 * Passive monitor worker — Sprint Q4.5 (Agent XXX).
 *
 * Repeatable cron `0 3 * * *` (03:00 UTC nightly). Per tick: list all tenants
 * with active candidates, run the passive scan, log per-tenant summaries.
 *
 * attempts=1: cron repeats next night anyway. Per-tenant try/catch isolates
 * failures so one bad tenant cannot break the whole sweep.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { passiveMonitorQueue } from '../queues';
import {
  scanCandidatesForSignals,
  listTenantIdsForScan,
} from '../../modules/monitoring/passiveMonitor.service';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const PASSIVE_MONITOR_CRON =
  process.env.PASSIVE_MONITOR_CRON ?? '0 3 * * *';
const REPEATABLE_JOB_ID = 'passive-monitor:nightly';

async function processJob(_job: Job): Promise<unknown> {
  const tenantIds = await listTenantIdsForScan();
  logger.info('[passiveMonitor] starting nightly sweep', { tenants: tenantIds.length });

  let total = { signals: 0, drafts: 0 };
  for (const tenantId of tenantIds) {
    try {
      const result = await scanCandidatesForSignals(tenantId);
      total.signals += result.signals_emitted;
      total.drafts += result.reactivations_drafted;
      logger.info('[passiveMonitor] tenant scan ok', { tenantId, ...result });
    } catch (err) {
      logger.error('[passiveMonitor] tenant scan failed', {
        tenantId,
        error: (err as Error).message,
      });
    }
  }

  logger.info('[passiveMonitor] sweep complete', total);
  return total;
}

// ─── Worker boot ─────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let passiveMonitorWorker: Worker | null = null;

if (!shouldStartWorker) {
  logger.info('[passiveMonitor] inline worker disabled');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  passiveMonitorWorker = new Worker(
    'passive-monitor',
    processJob,
    { connection }
  );
  passiveMonitorWorker.on('failed', (job, err) =>
    logger.error('[passiveMonitor] failed', {
      jobId: job?.id,
      error: err.message,
    })
  );

  // Schedule the cron — fire-and-forget; if Redis is offline tests will
  // catch this via the queue mock.
  void passiveMonitorQueue
    .add(
      REPEATABLE_JOB_ID,
      {},
      { repeat: { pattern: PASSIVE_MONITOR_CRON }, jobId: REPEATABLE_JOB_ID }
    )
    .catch((err: Error) => {
      logger.warn('[passiveMonitor] failed to schedule cron', { error: err.message });
    });
}

export { passiveMonitorWorker };

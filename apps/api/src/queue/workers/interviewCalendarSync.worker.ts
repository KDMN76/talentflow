/**
 * Interview calendar-sync worker — Sprint Q3.4 (Agent CCC).
 *
 * Repeatable cron job: pollt elke 10 minuten alle calendar-event-links over
 * alle tenants en synct binnenkomende remote-wijzigingen (cancel, reschedule).
 *
 * Cadence-keuze:
 *   - 10 min is conservatief en veilig binnen Google/Outlook quotas
 *     (200 links × 6 polls/uur = 1.200 reads/uur per provider).
 *   - Gebruikers verwachten geen <1min latency op kalender-cancellaties die
 *     in een externe app gebeuren — typisch worden recruiters daarvoor al
 *     per email gewaarschuwd door de provider zelf.
 *
 * Webhooks (Google `events.watch`, Outlook subscriptions) zijn een vervolg-
 * sprint zodra we stable HTTPS-callbacks in dev hebben.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { interviewCalendarSyncQueue } from '../queues';
import { syncAllTenantsIncomingChanges } from '../../modules/interviews/calendarSync.service';

const CRON_PATTERN = process.env.CALENDAR_POLL_CRON ?? '*/10 * * * *';

interface InterviewCalendarSyncJobData {
  // payload niet gebruikt — cron triggert simpelweg een full sweep.
  trigger?: 'cron' | 'manual';
}

async function processCalendarSyncJob(
  _job: Job<InterviewCalendarSyncJobData>
): Promise<void> {
  logger.info('[interviewCalendarSync] full-sweep started');
  try {
    const result = await syncAllTenantsIncomingChanges();
    logger.info('[interviewCalendarSync] full-sweep done', result);
  } catch (err) {
    logger.error('[interviewCalendarSync] full-sweep failed', {
      error: (err as Error).message,
    });
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Worker setup
// ────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let interviewCalendarSyncWorker: Worker<InterviewCalendarSyncJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[interviewCalendarSync] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  interviewCalendarSyncWorker = new Worker<InterviewCalendarSyncJobData>(
    'interview-calendar-sync',
    processCalendarSyncJob,
    { connection, concurrency: 1 }
  );

  interviewCalendarSyncWorker.on('completed', (job) => {
    logger.info('[interviewCalendarSync] Job completed', { jobId: job.id });
  });
  interviewCalendarSyncWorker.on('failed', (job, err) => {
    logger.error('[interviewCalendarSync] Job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  // Repeatable cron — idempotent via jobId.
  interviewCalendarSyncQueue
    .add(
      'sync-all',
      { trigger: 'cron' },
      { repeat: { pattern: CRON_PATTERN }, jobId: 'interview-calendar-sync-all' }
    )
    .then(() => {
      logger.info(
        `[interviewCalendarSync] repeatable cron registered (${CRON_PATTERN})`
      );
    })
    .catch((err: Error) => {
      logger.warn('[interviewCalendarSync] failed to register cron', {
        error: err.message,
      });
    });
}

export { interviewCalendarSyncWorker };

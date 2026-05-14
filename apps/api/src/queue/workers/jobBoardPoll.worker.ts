/**
 * Job-board POLL worker — Sprint Q4.3 (Agent QQQ).
 *
 * Twee inputs:
 *   1. `job-board-poll` queue — per-posting poll geïnitieerd door de
 *      periodieke scheduler (`pollAllStatuses()` in service.ts).
 *   2. Repeatable scheduler — registreert een cron-job die elke 30min
 *      `pollAllStatuses` uitvoert. We hangen de scheduler aan dezelfde
 *      worker process zodat hij meeschaalt met de queue-workers.
 *
 * Per poll-job:
 *   - Laad de posting + connector + creds.
 *   - Roep `connector.pollStatus()` aan.
 *   - applyStatusUpdate() schrijft applicants_count + last_polled_at en
 *     genereert een status-event bij wijziging.
 */

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import {
  applyStatusUpdate,
  loadPostingForPoll,
  pollAllStatuses,
} from '../../modules/job-boards/service';
import { jobBoardPollQueue } from '../queues';

export interface JobBoardPollJobData {
  tenantId?: string;
  postingId?: string;
  /** Set door de scheduler — triggers cross-tenant fan-out. */
  scheduler?: boolean;
}

async function processPollJob(job: Job<JobBoardPollJobData>): Promise<unknown> {
  if (job.data.scheduler) {
    const count = await pollAllStatuses();
    return { scheduled: count };
  }
  const { tenantId, postingId } = job.data;
  if (!tenantId || !postingId) {
    logger.warn('[jobBoards] poll worker — missing job data', {
      data: job.data,
    });
    return { skipped: true };
  }
  const ctx = await loadPostingForPoll(tenantId, postingId);
  if (!ctx || !ctx.connector) {
    return { skipped: true };
  }
  // Geen creds → mock-mode ondersteund door de connector zelf.
  const creds =
    ctx.creds ??
    {
      id: 'no-integration',
      tenant_id: tenantId,
      settings: {},
      credentials: {},
    };

  try {
    const update = await ctx.connector.pollStatus(
      { tenantId, userId: null },
      {
        id: ctx.posting.id,
        external_id: ctx.posting.external_id,
        tenant_id: tenantId,
      },
      creds
    );
    if (update) {
      await applyStatusUpdate(tenantId, postingId, update);
    }
    return update ?? { noChange: true };
  } catch (err) {
    logger.warn('[jobBoards] poll worker — connector failed', {
      postingId,
      error: (err as Error).message,
    });
    // Geen re-throw — poll-failures retryen we niet, volgende cron-tick
    // probeert het opnieuw.
    return { error: (err as Error).message };
  }
}

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let jobBoardPollWorker: Worker<JobBoardPollJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[jobBoards] inline poll-worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    { maxRetriesPerRequest: null, enableReadyCheck: false }
  );
  jobBoardPollWorker = new Worker<JobBoardPollJobData>(
    'job-board-poll',
    processPollJob,
    { connection }
  );
  jobBoardPollWorker.on('completed', (job) => {
    logger.info('[jobBoards] poll job completed', { jobId: job.id });
  });
  jobBoardPollWorker.on('failed', (job, err) => {
    logger.error('[jobBoards] poll job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  // Repeatable scheduler — elke 30 min cross-tenant fan-out.
  // Idempotent: BullMQ dedupliceert op `jobId`.
  jobBoardPollQueue
    .add(
      'scheduler',
      { scheduler: true },
      {
        repeat: { every: 30 * 60 * 1000 },
        jobId: 'job-board-poll-scheduler',
      }
    )
    .catch((err) => {
      logger.error('[jobBoards] failed to register poll scheduler', {
        error: (err as Error).message,
      });
    });
}

export { jobBoardPollWorker, processPollJob };

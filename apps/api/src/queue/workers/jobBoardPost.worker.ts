/**
 * Job-board POST worker — Sprint Q4.3 (Agent QQQ).
 *
 * Verwerkt jobs uit `jobBoardPostQueue`. Per job:
 *   1. Laad de queued posting + job + integration-creds.
 *   2. Roep `connector.post()` aan.
 *   3. Schrijf het resultaat terug en log een `posted` status-event.
 *
 * Bij failure: status='failed' + status-event 'failed'. Re-throw zodat
 * BullMQ exponential backoff toepast (3 attempts).
 *
 * Env-guards (zelfde patroon als emailSender.worker.ts):
 *   - WORKER_PROCESS=1            → start altijd (dedicated worker container).
 *   - DISABLE_INLINE_WORKERS=true → skip inline-import (api-container).
 */

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import {
  applyPostFailure,
  applyPostResult,
  loadPostingForPost,
} from '../../modules/job-boards/service';

export interface JobBoardPostJobData {
  tenantId: string;
  postingId: string;
  boardId: string;
}

async function processPostJob(job: Job<JobBoardPostJobData>): Promise<unknown> {
  const { tenantId, postingId, boardId } = job.data;
  logger.info('[jobBoards] post worker — start', {
    jobId: job.id,
    tenantId,
    postingId,
    boardId,
  });

  const ctx = await loadPostingForPost(tenantId, postingId);
  if (!ctx) {
    logger.warn('[jobBoards] post worker — posting niet gevonden', {
      postingId,
    });
    return { skipped: true };
  }
  if (!ctx.connector) {
    const err = `Onbekende connector '${boardId}'`;
    await applyPostFailure(tenantId, postingId, err);
    throw new Error(err);
  }
  if (!ctx.creds) {
    const err = `Geen integration-creds voor '${boardId}'`;
    await applyPostFailure(tenantId, postingId, err);
    throw new Error(err);
  }
  if (ctx.posting.status !== 'queued') {
    logger.info('[jobBoards] post worker — posting niet meer queued', {
      postingId,
      status: ctx.posting.status,
    });
    return { skipped: true };
  }

  try {
    const result = await ctx.connector.post(
      { tenantId, userId: ctx.posting.created_by },
      ctx.job,
      ctx.creds
    );
    await applyPostResult(tenantId, postingId, result);
    logger.info('[jobBoards] post worker — done', {
      postingId,
      external_id: result.external_id,
    });
    return result;
  } catch (err) {
    const msg = (err as Error).message;
    await applyPostFailure(tenantId, postingId, msg);
    logger.error('[jobBoards] post worker — failed', {
      postingId,
      boardId,
      error: msg,
    });
    throw err;
  }
}

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let jobBoardPostWorker: Worker<JobBoardPostJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[jobBoards] inline post-worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    { maxRetriesPerRequest: null, enableReadyCheck: false }
  );
  jobBoardPostWorker = new Worker<JobBoardPostJobData>(
    'job-board-post',
    processPostJob,
    { connection }
  );
  jobBoardPostWorker.on('completed', (job) => {
    logger.info('[jobBoards] post job completed', { jobId: job.id });
  });
  jobBoardPostWorker.on('failed', (job, err) => {
    logger.error('[jobBoards] post job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });
}

export { jobBoardPostWorker, processPostJob };

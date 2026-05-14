/**
 * Reply-classification worker — Sprint Q4.5 (Agent XXX).
 *
 * Job-type: `classify-reply`. Payload: `{ tenantId, messageId }`. Runs the
 * heuristic-or-Claude classifier and then applies the suggested next_action.
 *
 * 2 attempts — Claude API can throw transient 429/5xx. After that the
 * classification falls back to heuristic in the service layer so we still
 * get a row.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import {
  classifyReply,
  applyNextAction,
} from '../../modules/outreach/replyClassifier.service';

interface JobData {
  tenantId: string;
  messageId: string;
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function processJob(job: Job<JobData>): Promise<unknown> {
  const { tenantId, messageId } = job.data;
  logger.info('[replyClassification] processing', { jobId: job.id, messageId });
  try {
    const classification = await classifyReply(tenantId, messageId);
    await applyNextAction(tenantId, classification.id);
    return { category: classification.category, applied: classification.next_action };
  } catch (err) {
    logger.error('[replyClassification] failed', {
      messageId,
      error: (err as Error).message,
    });
    throw err;
  }
}

// ─── Worker boot ─────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let replyClassificationWorker: Worker<JobData> | null = null;

if (!shouldStartWorker) {
  logger.info('[replyClassification] inline worker disabled');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  replyClassificationWorker = new Worker<JobData>(
    'reply-classification',
    processJob,
    { connection }
  );
}

export { replyClassificationWorker };

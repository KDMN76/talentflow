/**
 * LinkedIn outreach worker — Sprint Q4.5 (Agent XXX).
 *
 * Job-types: `send-linkedin`, `send-other`. Payload: `{ tenantId, messageId }`.
 *
 * Mock-mode (default): generates a synthetic external_id and a 95% success
 * rate so end-to-end tests stay green. Live-mode (gated on
 * `process.env.LINKEDIN_OUTREACH_LIVE === 'true'`) is a TODO(real-api) marker
 * — LinkedIn's official API for InMail / Connection requests requires
 * Sales Navigator + a partner program enrollment. Real integration lives
 * outside this sprint.
 *
 * The actual status update + audit + quota-decrement happens inside
 * `outreach.service.sendMessage` so this worker stays thin.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { sendMessage, type OutreachMessageRow } from '../../modules/outreach/outreach.service';

interface JobData {
  tenantId: string;
  messageId: string;
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function attemptSendLinkedIn(
  msg: OutreachMessageRow
): Promise<{ external_id: string; external_thread_id: string }> {
  const isLive = process.env.LINKEDIN_OUTREACH_LIVE === 'true';
  if (isLive) {
    // TODO(real-api): integrate with LinkedIn Sales Navigator outreach API.
    // For now we throw so live mode doesn't silently emit fake successes.
    throw new Error(
      'LINKEDIN_OUTREACH_LIVE=true but real API integration is not implemented'
    );
  }

  // Mock: 5% failure rate so retry-paths are exercised.
  const seed = parseInt(msg.id.replace(/-/g, '').slice(0, 8), 16) || 1;
  if ((seed % 100) < 5) {
    throw new Error('mock-linkedin: synthetic transient failure');
  }

  return {
    external_id: `mock-linkedin-${msg.id.slice(0, 8)}`,
    external_thread_id: `mock-thread-${msg.id.slice(0, 8)}`,
  };
}

async function processJob(job: Job<JobData>): Promise<unknown> {
  const { tenantId, messageId } = job.data;
  logger.info('[outreachLinkedIn] processing', { jobId: job.id, messageId });
  try {
    const result = await sendMessage(tenantId, messageId, attemptSendLinkedIn);
    logger.info('[outreachLinkedIn] sent', { messageId, external_id: result.external_id });
    return result;
  } catch (err) {
    logger.error('[outreachLinkedIn] send failed', {
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

let outreachLinkedInWorker: Worker<JobData> | null = null;

if (!shouldStartWorker) {
  logger.info('[outreachLinkedIn] inline worker disabled');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  outreachLinkedInWorker = new Worker<JobData>(
    'outreach-linkedin',
    processJob,
    { connection }
  );
  outreachLinkedInWorker.on('completed', (job) =>
    logger.info('[outreachLinkedIn] completed', { jobId: job.id })
  );
  outreachLinkedInWorker.on('failed', (job, err) =>
    logger.error('[outreachLinkedIn] failed', {
      jobId: job?.id,
      error: err.message,
    })
  );
}

export { outreachLinkedInWorker };

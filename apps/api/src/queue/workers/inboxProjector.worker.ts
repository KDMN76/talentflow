/**
 * Inbox projector worker — Sprint Q4.6 (Agent AAAA).
 *
 * Backstop for channel-writers that prefer a fire-and-forget enqueue over the
 * synchronous eventBus / direct-call path. Consumes
 * `{ tenantId, candidateId, communicationId, channel, direction, preview,
 *   timestamp }` payloads and replays them through
 * `lib/inboxProjector.recordCommunication`.
 *
 * The eventBus subscriber installed on module-load is the primary path —
 * this queue is the bounded-buffer fallback when a writer wants the
 * projection to happen outside its critical path.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import {
  recordCommunication,
  installInboxProjectorSubscriber,
} from '../../lib/inboxProjector';
import type { CommunicationCreatedPayload } from '../../lib/eventBus';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Always wire the synchronous eventBus subscriber so even tests/code that
// don't enqueue still get a thread row.
installInboxProjectorSubscriber();

async function processJob(job: Job<CommunicationCreatedPayload>): Promise<unknown> {
  const data = job.data;
  logger.info('[inboxProjector] processing', {
    jobId: job.id,
    candidateId: data.candidateId,
    channel: data.channel,
  });
  await recordCommunication({
    tenantId: data.tenantId,
    candidateId: data.candidateId,
    communicationId: data.communicationId,
    channel: data.channel,
    direction: data.direction,
    preview: data.preview,
    timestamp: data.timestamp,
    suppressEvent: true,
  });
  return { ok: true };
}

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let inboxProjectorWorker: Worker<CommunicationCreatedPayload> | null = null;

if (!shouldStartWorker) {
  logger.info('[inboxProjector] inline worker disabled');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  inboxProjectorWorker = new Worker<CommunicationCreatedPayload>(
    'inbox-projector',
    processJob,
    { connection }
  );
}

export { inboxProjectorWorker };

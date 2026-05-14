import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { processWorkflowEvent } from '../../modules/workflows/workflows.service';

// ── Job interfaces ────────────────────────────────────────────────────────────

export interface WorkflowEventJobData {
  tenantId: string;
  event: string;
  entityId: string;
  payload: Record<string, unknown>;
}

// ── Job processor ─────────────────────────────────────────────────────────────

async function processWorkflowJob(job: Job<WorkflowEventJobData>) {
  const { tenantId, event, entityId, payload } = job.data;

  logger.info('[workflowWorker] Processing job', {
    jobId: job.id,
    jobName: job.name,
    tenantId,
    event,
    entityId,
  });

  if (job.name === 'process-event') {
    await processWorkflowEvent(tenantId, event, entityId, payload);
    return { processed: true };
  }

  logger.warn('[workflowWorker] Unknown job name, skipping', { jobName: job.name, jobId: job.id });
  return { processed: false, reason: 'unknown job name' };
}

// ── Worker setup ──────────────────────────────────────────────────────────────

// DISABLE_INLINE_WORKERS guard — zie resumeParser.worker.ts voor details.
const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let workflowWorker: Worker<WorkflowEventJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[workflowWorker] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  workflowWorker = new Worker<WorkflowEventJobData>(
    'workflow-events',
    processWorkflowJob,
    { connection }
  );

  workflowWorker.on('completed', (job) => {
    logger.info('[workflowWorker] Job completed', { jobId: job.id, jobName: job.name });
  });

  workflowWorker.on('failed', (job, err) => {
    logger.error('[workflowWorker] Job failed', { jobId: job?.id, jobName: job?.name, error: err.message });
  });
}

export { workflowWorker };

/**
 * Retention worker — Sprint Q2.3.
 *
 * BullMQ worker + repeatable scheduler die elke nacht om 03:00 (server-
 * tijd) loopt en voor elke tenant de actieve `retention_policies`
 * uitvoert.
 *
 * Schedule:
 *   - Cron: `0 3 * * *`  (03:00 elke dag)
 *   - Repeatable job ID: `retention:daily`
 *   - Delay tussen tenants: 100ms (kleine yield-tijd zodat één tenant
 *     met veel kandidaten niet de pool monopoliseert)
 *
 * Metrics: per run log `[retention]` met:
 *   - tenants_processed
 *   - candidates_processed (sum across tenants)
 *   - errors
 *   - elapsed_ms
 */

import { Worker, Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import {
  applyRetentionPolicy,
  listAllEnabledRetentionPolicies,
  type RetentionRunResult,
} from '../../modules/compliance/retention.service';

// ─────────────────────────────────────────────────────────────────────────────
// Queue + scheduler
// ─────────────────────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queueConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const retentionQueue = new Queue('retention', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 50,
  },
});

const REPEATABLE_JOB_ID = 'retention:daily';
const REPEATABLE_CRON =
  process.env.RETENTION_CRON ?? '0 3 * * *'; // 03:00 dagelijks

/**
 * Plan de daily-retentie-job. Idempotent: als er al een repeatable job
 * met deze key bestaat, wordt deze niet opnieuw aangemaakt.
 */
export async function ensureRetentionScheduled(): Promise<void> {
  try {
    await retentionQueue.add(
      REPEATABLE_JOB_ID,
      { source: 'cron' },
      {
        repeat: { pattern: REPEATABLE_CRON },
        jobId: REPEATABLE_JOB_ID,
      }
    );
    logger.info('[retention] daily schedule registered', {
      cron: REPEATABLE_CRON,
    });
  } catch (err) {
    logger.error('[retention] failed to register schedule', {
      error: (err as Error).message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job processor
// ─────────────────────────────────────────────────────────────────────────────

interface RetentionJobResult {
  started_at: string;
  ended_at: string;
  elapsed_ms: number;
  tenants_processed: number;
  candidates_processed: number;
  candidates_archived: number;
  candidates_anonymized: number;
  candidates_deleted: number;
  errors: number;
  per_tenant: RetentionRunResult[];
}

async function processRetentionJob(_job: Job): Promise<RetentionJobResult> {
  const startedAt = new Date();
  const result: RetentionJobResult = {
    started_at: startedAt.toISOString(),
    ended_at: '',
    elapsed_ms: 0,
    tenants_processed: 0,
    candidates_processed: 0,
    candidates_archived: 0,
    candidates_anonymized: 0,
    candidates_deleted: 0,
    errors: 0,
    per_tenant: [],
  };

  let policies: Awaited<ReturnType<typeof listAllEnabledRetentionPolicies>>;
  try {
    policies = await listAllEnabledRetentionPolicies();
  } catch (err) {
    logger.error('[retention] failed to load policies', {
      error: (err as Error).message,
    });
    result.errors += 1;
    result.ended_at = new Date().toISOString();
    result.elapsed_ms = Date.now() - startedAt.getTime();
    return result;
  }

  // Group by tenant zodat we counts per tenant kunnen rapporteren.
  const tenantsSeen = new Set<string>();

  for (const policy of policies) {
    tenantsSeen.add(policy.tenant_id);
    try {
      const tenantResult = await applyRetentionPolicy(policy.tenant_id, policy);
      result.per_tenant.push(tenantResult);
      result.candidates_processed += tenantResult.candidates_processed;
      result.errors += tenantResult.errors;

      if (tenantResult.action === 'archive') {
        result.candidates_archived += tenantResult.candidates_processed;
      } else if (tenantResult.action === 'anonymize') {
        result.candidates_anonymized += tenantResult.candidates_processed;
      } else if (tenantResult.action === 'delete') {
        result.candidates_deleted += tenantResult.candidates_processed;
      }
    } catch (err) {
      result.errors += 1;
      logger.error('[retention] tenant policy failed', {
        tenantId: policy.tenant_id,
        policyId: policy.id,
        error: (err as Error).message,
      });
    }

    // Yield-tijdje tussen tenants — voorkomt dat één tenant met 500
    // expirations de pool monopoliseert.
    await new Promise((res) => setTimeout(res, 100));
  }

  result.tenants_processed = tenantsSeen.size;
  result.ended_at = new Date().toISOString();
  result.elapsed_ms = Date.now() - startedAt.getTime();

  logger.info('[retention] daily run finished', {
    tenants_processed: result.tenants_processed,
    candidates_processed: result.candidates_processed,
    archived: result.candidates_archived,
    anonymized: result.candidates_anonymized,
    deleted: result.candidates_deleted,
    errors: result.errors,
    elapsed_ms: result.elapsed_ms,
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker setup
// ─────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let retentionWorker: Worker | null = null;

if (!shouldStartWorker) {
  logger.info('[retention] inline worker disabled (DISABLE_INLINE_WORKERS=true)');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  retentionWorker = new Worker('retention', processRetentionJob, { connection });

  retentionWorker.on('completed', (job, _result) => {
    logger.info('[retention] Job completed', { jobId: job.id });
  });

  retentionWorker.on('failed', (job, err) => {
    logger.error('[retention] Job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  // Schedule de repeatable job pas nadat de worker geregistreerd is.
  // Niet awaiten — laat 'm in de achtergrond gebeuren zodat module-load
  // niet blockeert op Redis. Errors loggen we in ensureRetentionScheduled
  // zelf.
  void ensureRetentionScheduled();
}

export { retentionWorker, processRetentionJob };

/**
 * Sourcing-agent worker — Sprint Q4.5 (Agent WWW).
 *
 * Twee job-types:
 *   1) `sourcing-agent-run`        { tenantId, runId } → draait `runSearchAgent`.
 *   2) `sourcing-agent-stale-sweep` (cron) → markeert oude review_required-runs
 *      als `completed` na N dagen (per-tenant configurable).
 *
 * Cron registreert zichzelf als repeatable-job zodat in een fresh Redis-state
 * de scheduler altijd actief is. Vermijdt dubbele inserts via een vaste jobId.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { logger } from '../../middleware/errorHandler';
import { sourcingAgentQueue } from '../queues';
import { runSearchAgent } from '../../modules/sourcing/searchAgent.service';
import { withTenant } from '../../db/pool';

interface SourcingAgentRunJob {
  tenantId: string;
  runId: string;
}

interface StaleSweepJob {
  __sweep: true;
}

const DEFAULT_AUTO_CLOSE_DAYS = 7;
const SWEEP_CRON = process.env.SOURCING_STALE_SWEEP_CRON ?? '*/15 * * * *';
const SWEEP_REPEATABLE_ID = 'sourcing-stale-sweep:every-15min';

// ─────────────────────────────────────────────────────────────────────────────
// Job processor
// ─────────────────────────────────────────────────────────────────────────────

async function processJob(
  job: Job<SourcingAgentRunJob | StaleSweepJob>
): Promise<void> {
  const data = job.data as SourcingAgentRunJob | StaleSweepJob;
  if ('__sweep' in data) {
    await runStaleSweep();
    return;
  }
  const { tenantId, runId } = data;
  logger.info('[sourcingAgent] starting run', { tenantId, runId, jobId: job.id });
  try {
    const result = await runSearchAgent(tenantId, runId);
    logger.info('[sourcingAgent] run completed', {
      tenantId,
      runId,
      candidates: result.candidatesFound,
      iterations: result.iterations,
      status: result.status,
    });
  } catch (err) {
    logger.error('[sourcingAgent] run failed — marking failed', {
      tenantId,
      runId,
      error: (err as Error).message,
    });
    try {
      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE agent_runs
              SET status = 'failed', error_message = $3, finished_at = now(), updated_at = now()
            WHERE id = $1 AND tenant_id = $2`,
          [runId, tenantId, (err as Error).message.slice(0, 1000)]
        );
      });
    } catch (innerErr) {
      logger.error('[sourcingAgent] could not mark run failed', {
        runId,
        error: (innerErr as Error).message,
      });
    }
    throw err; // BullMQ retry
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stale-sweep (cron)
// ─────────────────────────────────────────────────────────────────────────────

const adminPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 30_000,
});
adminPool.on('error', (err) => {
  logger.error('[sourcingAgent/sweep] adminPool error', { error: err.message });
});

async function runStaleSweep(): Promise<void> {
  const client = await adminPool.connect();
  try {
    // Pak per tenant de auto_close_days uit tenant_settings als die bestaat,
    // anders default 7. Eén SQL die zowel de tabel-bestaan-check als de
    // close-actie afhandelt is fragile in test-fixtures — gebruik twee passes.
    let hasSettings = false;
    try {
      const r = await client.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_name = 'tenant_settings'
            AND table_schema = current_schema()
          LIMIT 1`
      );
      hasSettings = r.rowCount! > 0;
    } catch {
      hasSettings = false;
    }

    let sql: string;
    let params: unknown[];
    if (hasSettings) {
      sql = `
        UPDATE agent_runs ar
           SET status = 'completed',
               finished_at = COALESCE(ar.finished_at, now()),
               updated_at = now()
          FROM tenant_settings ts
         WHERE ar.tenant_id = ts.tenant_id
           AND ar.status = 'review_required'
           AND ar.updated_at < now() - (COALESCE(ts.sourcing_auto_close_days, $1)::int || ' days')::interval
        RETURNING ar.id`;
      params = [DEFAULT_AUTO_CLOSE_DAYS];
    } else {
      sql = `
        UPDATE agent_runs
           SET status = 'completed',
               finished_at = COALESCE(finished_at, now()),
               updated_at = now()
         WHERE status = 'review_required'
           AND updated_at < now() - ($1::int || ' days')::interval
        RETURNING id`;
      params = [DEFAULT_AUTO_CLOSE_DAYS];
    }

    const result = await client.query(sql, params);
    if (result.rowCount && result.rowCount > 0) {
      logger.info('[sourcingAgent/sweep] auto-closed stale runs', {
        count: result.rowCount,
      });
    }
  } catch (err) {
    logger.error('[sourcingAgent/sweep] failed', { error: (err as Error).message });
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker bootstrap
// ─────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let sourcingAgentWorker: Worker | null = null;

if (!shouldStartWorker) {
  logger.info('[sourcingAgent] inline worker disabled (DISABLE_INLINE_WORKERS=true)');
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  sourcingAgentWorker = new Worker('sourcing-agent', processJob, { connection });

  sourcingAgentWorker.on('completed', (job) => {
    logger.info('[sourcingAgent] Job completed', { jobId: job.id });
  });

  sourcingAgentWorker.on('failed', (job, err) => {
    logger.error('[sourcingAgent] Job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  // Register repeatable cron — idempotent via fixed jobId.
  void (async () => {
    try {
      await sourcingAgentQueue.add(
        'sourcing-agent-stale-sweep',
        { __sweep: true } as StaleSweepJob,
        {
          repeat: { pattern: SWEEP_CRON },
          jobId: SWEEP_REPEATABLE_ID,
          removeOnComplete: 10,
        }
      );
    } catch (err) {
      logger.warn('[sourcingAgent/sweep] repeatable register failed', {
        error: (err as Error).message,
      });
    }
  })();
}

export { sourcingAgentWorker, runStaleSweep };

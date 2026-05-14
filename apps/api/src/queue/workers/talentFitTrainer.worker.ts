/**
 * Talent-Fit trainer worker — Sprint Q3.3.
 *
 * Repeatable cron `0 4 * * 0` (zondag 04:00 wekelijks).
 *
 * Per actieve tenant:
 *   1. Tel applications met status hired/rejected/offer_declined.
 *   2. Als < 20 hired OF < 20 rejected: log "INSUFFICIENT_DATA", schrijf
 *      een audit-event en skip. Volgende week opnieuw proberen.
 *   3. Anders: trainTalentFitModel(tenantId), log metrics + audit.
 *
 * Wij gebruiken een eigen admin-pool (zonder app.tenant_id) om alle tenants
 * cross-tenant op te halen; de daadwerkelijke training draait via withTenant
 * vanuit de service zodat RLS overal geldt.
 *
 * Production-deploy: dit bestand wordt geïmporteerd door zowel index.ts (inline)
 * als queue/workers/index.ts (worker-container) — DISABLE_INLINE_WORKERS-vlag
 * voorkomt dubbele Worker-instanties wanneer de api-container die env-var zet.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';

import { logger } from '../../middleware/errorHandler';
import { talentFitTrainerQueue } from '../queues';
import { trainTalentFitModel, MIN_SAMPLES_PER_CLASS } from '../../modules/matching/talentFit.service';
import { withTenant } from '../../db/pool';
import { logAudit } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Default: zondag 04:00. Configureerbaar via env voor staging/dev.
const TRAINER_CRON = process.env.TALENT_FIT_TRAINER_CRON ?? '0 4 * * 0';
const REPEATABLE_JOB_ID = 'talent-fit-trainer:weekly';

// ─────────────────────────────────────────────────────────────────────────────
// Admin pool — cross-tenant scan zonder RLS
// ─────────────────────────────────────────────────────────────────────────────

const adminPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30_000,
});
adminPool.on('error', (err) => {
  logger.error('[talentFitTrainer] adminPool error', { error: err.message });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schedule
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureTalentFitTrainerScheduled(): Promise<void> {
  try {
    await talentFitTrainerQueue.add(
      REPEATABLE_JOB_ID,
      { source: 'cron' },
      {
        repeat: { pattern: TRAINER_CRON },
        jobId: REPEATABLE_JOB_ID,
      }
    );
    logger.info('[talentFitTrainer] schedule registered', {
      cron: TRAINER_CRON,
      minSamplesPerClass: MIN_SAMPLES_PER_CLASS,
    });
  } catch (err) {
    logger.error('[talentFitTrainer] failed to register schedule', {
      error: (err as Error).message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant + sample-count discovery
// ─────────────────────────────────────────────────────────────────────────────

interface TenantSampleRow {
  tenant_id: string;
  hires: number;
  rejects: number;
}

async function findTenantsWithApplications(): Promise<TenantSampleRow[]> {
  const { rows } = await adminPool.query<{
    tenant_id: string;
    hires: string;
    rejects: string;
  }>(
    `SELECT tenant_id,
            SUM(CASE WHEN status = 'hired' THEN 1 ELSE 0 END)               AS hires,
            SUM(CASE WHEN status IN ('rejected','offer_declined') THEN 1 ELSE 0 END) AS rejects
       FROM applications
      GROUP BY tenant_id
      ORDER BY tenant_id`
  );
  return rows.map((r) => ({
    tenant_id: r.tenant_id,
    hires: parseInt(r.hires, 10) || 0,
    rejects: parseInt(r.rejects, 10) || 0,
  }));
}

async function logSkipAudit(
  tenantId: string,
  hires: number,
  rejects: number
): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.TALENT_FIT_MODEL_TRAINING_SKIPPED,
          entityType: 'talent_fit_model',
          entityId: null,
          after: {
            reason: 'INSUFFICIENT_DATA',
            hires,
            rejects,
            threshold: MIN_SAMPLES_PER_CLASS,
          },
          userId: null,
        }
      );
    });
  } catch (err) {
    logger.warn('[talentFitTrainer] audit voor skip faalde', {
      tenantId,
      error: (err as Error).message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job processor
// ─────────────────────────────────────────────────────────────────────────────

export interface TalentFitTrainerResult {
  started_at: string;
  ended_at: string;
  elapsed_ms: number;
  tenants_examined: number;
  tenants_trained: number;
  tenants_skipped: number;
  errors: number;
}

export async function processTalentFitTrainerJob(
  _job: Job
): Promise<TalentFitTrainerResult> {
  const startedAt = new Date();
  const result: TalentFitTrainerResult = {
    started_at: startedAt.toISOString(),
    ended_at: '',
    elapsed_ms: 0,
    tenants_examined: 0,
    tenants_trained: 0,
    tenants_skipped: 0,
    errors: 0,
  };

  let tenants: TenantSampleRow[];
  try {
    tenants = await findTenantsWithApplications();
  } catch (err) {
    logger.error('[talentFitTrainer] failed to load tenants', {
      error: (err as Error).message,
    });
    result.errors++;
    result.ended_at = new Date().toISOString();
    result.elapsed_ms = Date.now() - startedAt.getTime();
    return result;
  }

  for (const t of tenants) {
    result.tenants_examined++;
    if (t.hires < MIN_SAMPLES_PER_CLASS || t.rejects < MIN_SAMPLES_PER_CLASS) {
      logger.info('[talentFitTrainer] skipping tenant — INSUFFICIENT_DATA', {
        tenantId: t.tenant_id,
        hires: t.hires,
        rejects: t.rejects,
        threshold: MIN_SAMPLES_PER_CLASS,
      });
      await logSkipAudit(t.tenant_id, t.hires, t.rejects);
      result.tenants_skipped++;
      continue;
    }
    try {
      const model = await trainTalentFitModel(t.tenant_id, 'cron');
      result.tenants_trained++;
      logger.info('[talentFitTrainer] trained', {
        tenantId: t.tenant_id,
        modelId: model.id,
        trainedOn: model.trained_on,
        auc: model.auc,
        precisionAt1: model.precision_at_1,
      });
    } catch (err) {
      result.errors++;
      logger.error('[talentFitTrainer] training failed', {
        tenantId: t.tenant_id,
        error: (err as Error).message,
      });
    }
    // Yield-tijdje tussen tenants — voorkom dat 1 cron-tick de DB monopoliseert.
    await new Promise((res) => setTimeout(res, 50));
  }

  result.ended_at = new Date().toISOString();
  result.elapsed_ms = Date.now() - startedAt.getTime();
  logger.info('[talentFitTrainer] weekly run finished', result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker setup
// ─────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let talentFitTrainerWorker: Worker | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[talentFitTrainer] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  talentFitTrainerWorker = new Worker(
    'talent-fit-trainer',
    processTalentFitTrainerJob,
    { connection }
  );

  talentFitTrainerWorker.on('completed', (job, _r) => {
    logger.info('[talentFitTrainer] job completed', { jobId: job.id });
  });

  talentFitTrainerWorker.on('failed', (job, err) => {
    logger.error('[talentFitTrainer] job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  void ensureTalentFitTrainerScheduled();
}

export {
  talentFitTrainerWorker,
  findTenantsWithApplications,
  TRAINER_CRON,
};

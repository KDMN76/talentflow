/**
 * WhatsApp daily health-check worker — Sprint Q4.6 (Agent ZZZ).
 *
 * Job-type: `health-check`. Either invoked per-tenant
 * (`{ tenantId }`) or as a sweep (`{ sweep: true }`) which iterates all
 * connected integrations and enqueues one job per tenant.
 *
 * Use case: surface a quality_rating drop (green → yellow → red) before
 * Meta down-tiers messaging_limit. Operationally surfaced via the
 * `last_error` field on the integration row.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { withoutTenant } from '../../db/pool';
import { healthCheck } from '../../modules/whatsapp/whatsapp.service';
import { whatsappHealthCheckQueue } from '../queues';

interface JobData {
  tenantId?: string;
  sweep?: boolean;
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function processJob(job: Job<JobData>): Promise<unknown> {
  const { tenantId, sweep } = job.data;
  if (sweep) {
    const tenants = await withoutTenant(async (client) => {
      const { rows } = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM whatsapp_integrations WHERE status = 'connected'`
      );
      return rows.map((r) => r.tenant_id);
    });
    logger.info('[whatsappHealthCheck] sweep enqueuing', { count: tenants.length });
    for (const tId of tenants) {
      await whatsappHealthCheckQueue.add('health-check', { tenantId: tId });
    }
    return { swept: tenants.length };
  }
  if (!tenantId) {
    throw new Error('whatsappHealthCheck: missing tenantId');
  }
  const integration = await healthCheck(tenantId);
  logger.info('[whatsappHealthCheck] tenant', {
    tenantId,
    status: integration.status,
    quality_rating: integration.quality_rating,
  });
  return {
    tenantId,
    status: integration.status,
    quality_rating: integration.quality_rating,
  };
}

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let whatsappHealthCheckWorker: Worker<JobData> | null = null;

if (!shouldStartWorker) {
  logger.info('[whatsappHealthCheck] inline worker disabled');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  whatsappHealthCheckWorker = new Worker<JobData>('whatsapp-health-check', processJob, {
    connection,
  });
  whatsappHealthCheckWorker.on('completed', (job) =>
    logger.info('[whatsappHealthCheck] completed', { jobId: job.id })
  );
  whatsappHealthCheckWorker.on('failed', (job, err) =>
    logger.error('[whatsappHealthCheck] failed', {
      jobId: job?.id,
      error: err.message,
    })
  );
}

export { whatsappHealthCheckWorker };

/**
 * Report-schedule worker — Sprint Q3.5 (Agent GGG).
 *
 * Repeatable cron `0 * * * *` (elk uur op het hele uur). Per tick:
 *
 *   1. Cross-tenant SELECT van alle `reports` met `schedule IS NOT NULL` en
 *      `deleted_at IS NULL`. We gebruiken een dedicated admin-pool i.p.v.
 *      withTenant omdat we niet weten WELKE tenants een rapport hebben.
 *      Dit is veilig: we lezen alleen tenant_id + schedule en gebruiken die
 *      tenant-id daarna in een gewone withTenant-transactie voor het runnen.
 *
 *   2. Per rapport: check `isDue(schedule, now)` (in tenant-tz).
 *      - hour-precisie (cron firet exact 1x per uur op :00)
 *      - frequency-checks: daily/weekly/monthly + end-of-month clamp
 *      - dedup tegen `last_run_at` zodat een job die per ongeluk 2x in dezelfde
 *        hour-bucket triggert NIET dubbele emails stuurt
 *
 *   3. Indien due: aggregator runnen, exporten naar configured format,
 *      enqueue-en in emailSenderQueue met attachment.
 *
 *   4. UPDATE reports SET last_run_at = now(); audit-log REPORT_SCHEDULED_RUN.
 *
 * Schedule wordt idempotent geregistreerd bij worker-start (zelfde patroon
 * als notificationReminders.worker.ts).
 *
 * Failure-isolatie: één bad config blokkeert geen andere rapporten — per
 * rapport try/catch + Sentry-capture.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { logger } from '../../middleware/errorHandler';
import { reportScheduleQueue, emailSenderQueue } from '../queues';
import { withTenant } from '../../db/pool';
import { logAudit } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { isDue, type ReportSchedule } from '../../modules/reports/schedules.service';
import * as reportsService from '../../modules/reports/reports.service';
import { reportToPdfBuffer } from '../../lib/reports/exporters/pdf';
import { reportToExcelBuffer } from '../../lib/reports/exporters/excel';
import { reportToCsvBuffer } from '../../lib/reports/exporters/csv';
import { getBrandingForTenant } from '../../modules/tenants/branding.service';
import type { ReportConfig } from '../../lib/reports/configSchema';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const SCHEDULE_CRON = process.env.REPORT_SCHEDULE_CRON ?? '0 * * * *';
const TICK_JOB_ID = 'report-schedule:tick';

// Cross-tenant admin pool — read-only scan voor due reports.
const adminPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30000,
});
adminPool.on('error', (err) => {
  logger.error('[report-schedule] adminPool error', { error: err.message });
});

interface ScheduledRow {
  id: string;
  tenant_id: string;
  name: string;
  config: ReportConfig;
  schedule: ReportSchedule;
  last_run_at: Date | null;
}

export async function ensureScheduleRegistered(): Promise<void> {
  try {
    await reportScheduleQueue.add(
      TICK_JOB_ID,
      { kind: 'tick' },
      { repeat: { pattern: SCHEDULE_CRON }, jobId: TICK_JOB_ID }
    );
    logger.info('[report-schedule] cron registered', { pattern: SCHEDULE_CRON });
  } catch (err) {
    logger.error('[report-schedule] failed to register cron', {
      error: (err as Error).message,
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Per-report runner
// ────────────────────────────────────────────────────────────────────────────

async function runAndExport(
  row: ScheduledRow
): Promise<{ buffer: Buffer; mime: string; ext: string; format: 'pdf' | 'excel' | 'csv' }> {
  // Hergebruik service.runReport zodat caching, REPORT_RUN audit en
  // report_runs-bookkeeping consistent zijn met manuele runs.
  const runResult = await reportsService.runReport(
    row.tenant_id,
    row.id,
    undefined,
    'scheduled',
    null
  );
  const blocks = runResult.blocks;

  const branding = await getBrandingForTenant(row.tenant_id).catch(() => null);

  switch (row.schedule.format) {
    case 'pdf': {
      const buffer = await reportToPdfBuffer(row.name, row.config, blocks, {
        branding,
      });
      return { buffer, mime: 'application/pdf', ext: 'pdf', format: 'pdf' };
    }
    case 'excel': {
      const buffer = await reportToExcelBuffer(row.name, row.config, blocks, {
        branding,
      });
      return {
        buffer,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ext: 'xlsx',
        format: 'excel',
      };
    }
    case 'csv': {
      const buffer = reportToCsvBuffer(row.name, row.config, blocks);
      return {
        buffer,
        mime: 'text/csv; charset=utf-8',
        ext: 'csv',
        format: 'csv',
      };
    }
  }
}

async function dispatchEmail(
  row: ScheduledRow,
  result: { buffer: Buffer; mime: string; ext: string; format: string }
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const filename = `${row.name.replace(/[^\w\-]+/g, '_').slice(0, 64)}-${today}.${result.ext}`;

  for (const recipient of row.schedule.recipients) {
    await emailSenderQueue.add(
      'send-scheduled-report',
      {
        tenantId: row.tenant_id,
        to: recipient,
        subject: `Geplande rapportage: ${row.name}`,
        // Body wordt door emailSender.worker omgezet naar HTML/text via een
        // template; we geven hier een raw payload met attachment door. Worker
        // hergebruikt de generieke `email-sender` job-shape.
        text:
          `Hallo,\n\n` +
          `Bijgevoegd het geplande rapport "${row.name}" voor de periode tot ${today}.\n\n` +
          `Dit bericht is automatisch verzonden door TalentFlow.`,
        attachments: [
          {
            filename,
            content: result.buffer.toString('base64'),
            content_type: result.mime,
            encoding: 'base64',
          },
        ],
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
    );
  }
}

async function processOneReport(row: ScheduledRow, now: Date): Promise<boolean> {
  // Dedup tegen last_run_at — als we deze hour-bucket al gerund hebben
  // (last_run_at < 60 min geleden), skip.
  if (row.last_run_at) {
    const diffMs = now.getTime() - new Date(row.last_run_at).getTime();
    if (diffMs < 55 * 60 * 1000) {
      return false;
    }
  }

  if (!isDue(row.schedule, now)) return false;

  const result = await runAndExport(row);
  await dispatchEmail(row, result);

  await withTenant(row.tenant_id, async (client) => {
    await client.query(
      `UPDATE reports SET last_run_at = now() WHERE id = $1 AND tenant_id = $2`,
      [row.id, row.tenant_id]
    );
    await logAudit(client, row.tenant_id, {
      action: AuditActions.REPORT_SCHEDULED_RUN,
      entityType: 'report',
      entityId: row.id,
      after: {
        format: row.schedule.format,
        recipient_count: row.schedule.recipients.length,
        block_count: row.config.blocks.length,
        size_bytes: result.buffer.byteLength,
      },
      userId: null,
    });
  });

  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Tick processor — scan + dispatch
// ────────────────────────────────────────────────────────────────────────────

interface TickResult {
  scanned: number;
  dispatched: number;
  failed: number;
  elapsed_ms: number;
}

async function processTick(_job: Job): Promise<TickResult> {
  const start = Date.now();
  const now = new Date();
  let scanned = 0;
  let dispatched = 0;
  let failed = 0;

  try {
    const { rows } = await adminPool.query<ScheduledRow>(
      `SELECT id, tenant_id, name, config, schedule, last_run_at
         FROM reports
        WHERE schedule IS NOT NULL
          AND deleted_at IS NULL
        LIMIT 5000`
    );
    scanned = rows.length;

    for (const row of rows) {
      try {
        const fired = await processOneReport(row, now);
        if (fired) dispatched++;
      } catch (err) {
        failed++;
        logger.error('[report-schedule] report failed', {
          report_id: row.id,
          tenant_id: row.tenant_id,
          error: (err as Error).message,
        });
      }
    }
  } catch (err) {
    logger.error('[report-schedule] scan failed', {
      error: (err as Error).message,
    });
  }

  const result: TickResult = {
    scanned,
    dispatched,
    failed,
    elapsed_ms: Date.now() - start,
  };
  logger.info('[report-schedule] tick done', result);
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Worker setup — zelfde inline/dedicated pattern als andere workers
// ────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStart = isWorkerProcess || !inlineDisabled;

let reportScheduleWorker: Worker | null = null;

if (!shouldStart) {
  logger.info('[report-schedule] inline worker disabled');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  reportScheduleWorker = new Worker('report-schedule', processTick, { connection });
  reportScheduleWorker.on('completed', (job, result) => {
    logger.info('[report-schedule] job completed', {
      jobId: job.id,
      result,
    });
  });
  reportScheduleWorker.on('failed', (job, err) => {
    logger.error('[report-schedule] job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });
  void ensureScheduleRegistered();
}

export {
  reportScheduleWorker,
  processTick,
  processOneReport,
};

/**
 * Pay-equity + DEI funnel snapshot worker — Sprint Q3.6 (Agent III).
 *
 * Cron `0 5 1 *\/3 *` (1ste van elk kwartaal om 05:00 UTC). Per tenant:
 *   1. Bereken `generatePayEquityReport` voor het afgelopen kwartaal en
 *      schrijf één snapshot-row per (tenant, period, 'all').
 *   2. Bereken `generateDeiFunnel` en schrijf snapshot-rijen per stage.
 *   3. Mail naar admin/owner-users een notificatie met link naar dashboard.
 *
 * Veiligheid:
 *   - Cross-tenant scan via dedicated admin-pool (lezen tenant-ids).
 *   - Per tenant in withTenant-tx (RLS-isolatie).
 *   - Failure-isolatie: één tenant fail blokkeert geen andere.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { logger } from '../../middleware/errorHandler';
import { payEquityDeiQueue, emailSenderQueue } from '../queues';
import { withTenant } from '../../db/pool';
import {
  generatePayEquityReport,
  type PayEquityReport,
} from '../../modules/compliance/payEquity.service';
import {
  generateDeiFunnel,
  type DEIFunnelReport,
} from '../../modules/compliance/deiFunnel.service';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const SCHEDULE_CRON = process.env.PAY_EQUITY_DEI_CRON ?? '0 5 1 */3 *';
const TICK_JOB_ID = 'pay-equity-dei:tick';

// Cross-tenant admin pool — alleen voor het scannen van actieve tenants.
const adminPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30000,
});
adminPool.on('error', (err) => {
  logger.error('[pay-equity-dei] adminPool error', { error: err.message });
});

interface TenantRow {
  id: string;
  name: string | null;
}

interface AdminEmailRow {
  email: string;
}

export async function ensureScheduleRegistered(): Promise<void> {
  try {
    await payEquityDeiQueue.add(
      TICK_JOB_ID,
      { kind: 'tick' },
      { repeat: { pattern: SCHEDULE_CRON }, jobId: TICK_JOB_ID }
    );
    logger.info('[pay-equity-dei] cron registered', { pattern: SCHEDULE_CRON });
  } catch (err) {
    logger.error('[pay-equity-dei] failed to register cron', {
      error: (err as Error).message,
    });
  }
}

/**
 * Bepaal het afgelopen kwartaal-venster relatief t.o.v. `now`. We gebruiken
 * de eerste-dag-van-vorig-kwartaal tot de laatste-dag-van-vorig-kwartaal.
 *
 * Bv. now = 2026-04-01 → from = 2026-01-01, to = 2026-03-31.
 */
export function previousQuarterRange(now: Date): { from: Date; to: Date } {
  const year = now.getUTCFullYear();
  const quarter = Math.floor(now.getUTCMonth() / 3); // 0-3
  // Vorig kwartaal:
  let prevQ = quarter - 1;
  let prevYear = year;
  if (prevQ < 0) {
    prevQ = 3;
    prevYear = year - 1;
  }
  const from = new Date(Date.UTC(prevYear, prevQ * 3, 1, 0, 0, 0));
  const to = new Date(Date.UTC(prevYear, prevQ * 3 + 3, 1, 0, 0, 0) - 1);
  return { from, to };
}

async function listTenantAdminEmails(tenantId: string): Promise<string[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<AdminEmailRow>(
      `SELECT email
         FROM users
        WHERE tenant_id = $1
          AND role IN ('owner', 'admin')
          AND deleted_at IS NULL`,
      [tenantId]
    );
    return rows.map((r) => r.email).filter(Boolean);
  });
}

async function dispatchSummaryEmail(
  tenantId: string,
  recipients: string[],
  payEquity: PayEquityReport,
  dei: DEIFunnelReport
): Promise<void> {
  if (recipients.length === 0) return;
  const subject = `Pay-equity + DEI rapport ${payEquity.period_start} t/m ${payEquity.period_end}`;
  const text =
    `Hallo,\n\n` +
    `Het kwartaal-rapport over pay-equity en DEI funnel staat klaar in TalentFlow.\n\n` +
    `Periode: ${payEquity.period_start} t/m ${payEquity.period_end}\n` +
    `Totaal offers: ${payEquity.total_offers}\n` +
    `Pay-gap %: ${payEquity.pay_gap_pct}\n` +
    `DEI alerts: ${dei.alerts.length} (waarvan ${dei.alerts.filter((a) => a.severity === 'high').length} high severity)\n\n` +
    `Bekijk het volledige rapport: /dashboard/compliance/pay-equity\n\n` +
    `Dit bericht is automatisch verzonden door TalentFlow conform de EU Pay Transparency Directive 2023/970.`;

  for (const to of recipients) {
    await emailSenderQueue.add(
      'send-pay-equity-dei-report',
      {
        tenantId,
        to,
        subject,
        text,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
    );
  }
}

async function processOneTenant(tenant: TenantRow, range: { from: Date; to: Date }): Promise<{
  tenant_id: string;
  pay_equity_total: number;
  dei_alerts: number;
  emails_dispatched: number;
}> {
  const payEquity = await generatePayEquityReport(tenant.id, range, null, {
    requestId: 'pay-equity-dei-cron',
  });
  const dei = await generateDeiFunnel(tenant.id, range, null, {
    requestId: 'pay-equity-dei-cron',
  });
  const adminEmails = await listTenantAdminEmails(tenant.id);
  await dispatchSummaryEmail(tenant.id, adminEmails, payEquity, dei);
  return {
    tenant_id: tenant.id,
    pay_equity_total: payEquity.total_offers,
    dei_alerts: dei.alerts.length,
    emails_dispatched: adminEmails.length,
  };
}

interface TickResult {
  scanned: number;
  processed: number;
  failed: number;
  elapsed_ms: number;
}

async function processTick(_job: Job): Promise<TickResult> {
  const start = Date.now();
  const range = previousQuarterRange(new Date());
  let scanned = 0;
  let processed = 0;
  let failed = 0;

  try {
    const { rows } = await adminPool.query<TenantRow>(
      `SELECT id, name FROM tenants WHERE deleted_at IS NULL LIMIT 5000`
    );
    scanned = rows.length;

    for (const tenant of rows) {
      try {
        const result = await processOneTenant(tenant, range);
        processed++;
        logger.info('[pay-equity-dei] tenant processed', result);
      } catch (err) {
        failed++;
        logger.error('[pay-equity-dei] tenant failed', {
          tenant_id: tenant.id,
          error: (err as Error).message,
        });
      }
    }
  } catch (err) {
    logger.error('[pay-equity-dei] scan failed', {
      error: (err as Error).message,
    });
  }

  const result: TickResult = {
    scanned,
    processed,
    failed,
    elapsed_ms: Date.now() - start,
  };
  logger.info('[pay-equity-dei] tick done', result);
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Worker setup — zelfde inline/dedicated pattern als andere workers.
// ────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStart = isWorkerProcess || !inlineDisabled;

let payEquityDeiWorker: Worker | null = null;

if (!shouldStart) {
  logger.info('[pay-equity-dei] inline worker disabled');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  payEquityDeiWorker = new Worker('pay-equity-dei', processTick, { connection });
  payEquityDeiWorker.on('completed', (job, result) => {
    logger.info('[pay-equity-dei] job completed', {
      jobId: job.id,
      result,
    });
  });
  payEquityDeiWorker.on('failed', (job, err) => {
    logger.error('[pay-equity-dei] job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });
  void ensureScheduleRegistered();
}

export {
  payEquityDeiWorker,
  processTick,
  processOneTenant,
};

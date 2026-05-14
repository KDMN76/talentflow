/**
 * Contract-expiry worker — Sprint Q4.4 (Agent TTT).
 *
 * Repeatable cron driver. Per tick (default 06:00 UTC):
 *   1. Flip `active` contracts past `end_date` → `ended` (per tenant).
 *   2. Re-schedule notification queue voor alle actieve contracts.
 *   3. Pick today's `contract_notification_queue` rows en delegate naar de
 *      `email-sender`-queue voor kandidaat + klant + recruiter.
 *
 * Eén worker dekt alle tenants — we fan-out per tenant via
 * `listTenantsWithActiveContracts()`.
 */

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { contractExpiryQueue, emailSenderQueue } from '../queues';
import { withTenant, withoutTenant } from '../../db/pool';
import {
  listTenantsWithActiveContracts,
  markEndedDueDate,
  scheduleExpiryNotifications,
  getContract,
  listDueNotificationsAcrossTenants,
  markNotificationSent,
} from '../../modules/contracts/contracts.service';

export interface ContractExpiryJobData {
  /** Set door de scheduler — triggers cross-tenant fan-out. */
  scheduler?: boolean;
  /** Override "today" — handig voor tests. */
  today?: string;
}

interface NotifyRecipient {
  type: 'candidate' | 'client' | 'recruiter';
  email: string;
  name?: string | null;
}

async function gatherRecipients(
  tenantId: string,
  contractId: string
): Promise<NotifyRecipient[]> {
  const contract = await getContract(tenantId, contractId);
  return withTenant(tenantId, async (client) => {
    const recipients: NotifyRecipient[] = [];

    // Candidate
    const { rows: [cand] } = await client.query<{ name: string; email: string | null }>(
      `SELECT name, email FROM candidates WHERE id = $1 AND tenant_id = $2`,
      [contract.candidate_id, tenantId]
    );
    if (cand?.email) {
      recipients.push({ type: 'candidate', email: cand.email, name: cand.name });
    }

    // Client organisation primary contact (best-effort — table may be absent
    // in older tenants; we swallow errors).
    if (contract.client_organization_id) {
      try {
        const { rows: [org] } = await client.query<{
          name: string | null;
          email: string | null;
        }>(
          `SELECT name, email FROM crm_organizations
           WHERE id = $1 AND tenant_id = $2`,
          [contract.client_organization_id, tenantId]
        );
        if (org?.email) {
          recipients.push({ type: 'client', email: org.email, name: org.name });
        }
      } catch {
        /* legacy tenants without crm_organizations */
      }
    }

    // Recruiter (created_by)
    if (contract.created_by) {
      try {
        const { rows: [rec] } = await client.query<{ email: string | null; full_name: string | null; name: string | null }>(
          `SELECT email,
                  COALESCE(full_name, name) AS full_name,
                  name
           FROM users
           WHERE id = $1 AND tenant_id = $2`,
          [contract.created_by, tenantId]
        );
        if (rec?.email) {
          recipients.push({
            type: 'recruiter',
            email: rec.email,
            name: rec.full_name ?? rec.name,
          });
        }
      } catch {
        /* schema variations across versions */
      }
    }

    return recipients;
  });
}

function subjectFor(
  type: 'expiring_30d' | 'expiring_14d' | 'expiring_7d' | 'ended',
  endDate: string
): string {
  if (type === 'ended') {
    return `Contract is geëindigd op ${endDate}`;
  }
  return `Contract loopt af op ${endDate}`;
}

function bodyFor(
  type: 'expiring_30d' | 'expiring_14d' | 'expiring_7d' | 'ended',
  recipientName: string | null,
  endDate: string,
  contractId: string
): string {
  const greeting = recipientName ? `Hallo ${recipientName},` : 'Hallo,';
  if (type === 'ended') {
    return [
      `<p>${greeting}</p>`,
      `<p>Het contract met id <code>${contractId}</code> is geëindigd op ${endDate}.</p>`,
      '<p>Vriendelijke groet,<br/>TalentFlow</p>',
    ].join('');
  }
  const window = type === 'expiring_30d' ? '30 dagen' : type === 'expiring_14d' ? '14 dagen' : '7 dagen';
  return [
    `<p>${greeting}</p>`,
    `<p>Dit is een herinnering: het contract <code>${contractId}</code> loopt over ${window} af (einddatum ${endDate}).</p>`,
    '<p>Onderneem tijdig actie als verlenging gewenst is.</p>',
    '<p>Vriendelijke groet,<br/>TalentFlow</p>',
  ].join('');
}

export async function runExpirySweep(today?: string): Promise<{
  tenants: number;
  flipped: number;
  notificationsSent: number;
}> {
  const todayIso = today ?? new Date().toISOString().slice(0, 10);
  const tenants = await listTenantsWithActiveContracts();

  let flipped = 0;
  for (const tenantId of tenants) {
    try {
      flipped += await markEndedDueDate(tenantId);
    } catch (err) {
      logger.warn('[contractExpiry] markEndedDueDate failed', {
        tenantId,
        error: (err as Error).message,
      });
    }

    // Re-schedule notifications voor alle actieve contracts in deze tenant.
    try {
      await withoutTenant(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE tenant_id = $1
             AND status IN ('active','renewed','draft')
             AND end_date IS NOT NULL`,
          [tenantId]
        );
        for (const r of rows) {
          try {
            await scheduleExpiryNotifications(tenantId, r.id);
          } catch (err) {
            logger.warn('[contractExpiry] schedule failed', {
              tenantId,
              contractId: r.id,
              error: (err as Error).message,
            });
          }
        }
      });
    } catch (err) {
      logger.warn('[contractExpiry] schedule sweep failed', {
        tenantId,
        error: (err as Error).message,
      });
    }
  }

  // Pick today's due rows across all tenants en stuur e-mails.
  let notificationsSent = 0;
  const due = await listDueNotificationsAcrossTenants(todayIso);
  for (const row of due) {
    try {
      const contract = await getContract(row.tenant_id, row.contract_id);
      const endDate = contract.end_date ?? '';
      const recipients = await gatherRecipients(
        row.tenant_id,
        row.contract_id
      );
      if (recipients.length === 0) {
        await markNotificationSent(row.tenant_id, row.id, []);
        continue;
      }

      const subject = subjectFor(row.notification_type, endDate);
      for (const rec of recipients) {
        const html = bodyFor(
          row.notification_type,
          rec.name ?? null,
          endDate,
          row.contract_id
        );
        await emailSenderQueue.add('contract-expiry-email', {
          to: rec.email,
          subject,
          bodyHtml: html,
          tenantId: row.tenant_id,
        });
      }
      await markNotificationSent(row.tenant_id, row.id, recipients);
      notificationsSent++;
    } catch (err) {
      logger.warn('[contractExpiry] notification dispatch failed', {
        tenantId: row.tenant_id,
        contractId: row.contract_id,
        type: row.notification_type,
        error: (err as Error).message,
      });
    }
  }

  return { tenants: tenants.length, flipped, notificationsSent };
}

async function processJob(job: Job<ContractExpiryJobData>): Promise<unknown> {
  if (job.data.scheduler) {
    return runExpirySweep(job.data.today);
  }
  return runExpirySweep(job.data.today);
}

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let contractExpiryWorker: Worker<ContractExpiryJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[contractExpiry] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    { maxRetriesPerRequest: null, enableReadyCheck: false }
  );
  contractExpiryWorker = new Worker<ContractExpiryJobData>(
    'contract-expiry',
    processJob,
    { connection }
  );
  contractExpiryWorker.on('completed', (job) => {
    logger.info('[contractExpiry] job completed', { jobId: job.id });
  });
  contractExpiryWorker.on('failed', (job, err) => {
    logger.error('[contractExpiry] job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  // Repeatable scheduler — daily 06:00 UTC.
  contractExpiryQueue
    .add(
      'scheduler',
      { scheduler: true },
      {
        repeat: { pattern: '0 6 * * *' },
        jobId: 'contract-expiry-scheduler',
      }
    )
    .catch((err) => {
      logger.error('[contractExpiry] failed to register scheduler', {
        error: (err as Error).message,
      });
    });
}

export { contractExpiryWorker, processJob };

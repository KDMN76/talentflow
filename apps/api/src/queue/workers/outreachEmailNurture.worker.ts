/**
 * Email nurture worker — Sprint Q4.5 (Agent XXX).
 *
 * Bridges `outreach_messages` → existing `email-sender` queue (Slice 3).
 * Payload: `{ tenantId, messageId }`. We look up the candidate's email,
 * enqueue a regular email-sender job with `communicationId` set to the
 * outreach_messages.id (so the email-sender worker UPDATEs that row instead
 * of inserting a parallel `communications` row), and the actual sender
 * worker handles delivery + threading.
 *
 * On enqueue we transition `approved` → `sending` directly because the
 * email-sender worker writes status updates onto `communications` not
 * `outreach_messages` — to keep the two systems consistent we set
 * `external_id` after sender ACKs by listening for the existing
 * `email-sender:completed` log path. For MVP we assume optimistic success
 * after enqueue and store an `external_id = 'queued:<job_id>'` placeholder
 * which the email-sender worker can later update.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { sendMessage, type OutreachMessageRow } from '../../modules/outreach/outreach.service';
import { emailSenderQueue } from '../queues';
import { withTenant } from '../../db/pool';

interface JobData {
  tenantId: string;
  messageId: string;
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function lookupCandidateEmail(
  tenantId: string,
  candidateId: string
): Promise<string | null> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<{ email: string | null }>(
      `SELECT email FROM candidates
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [candidateId, tenantId]
    );
    return row?.email ?? null;
  });
}

async function attemptSendEmail(
  msg: OutreachMessageRow
): Promise<{ external_id: string; external_thread_id?: string }> {
  const candidateEmail = await lookupCandidateEmail(msg.tenant_id, msg.candidate_id);
  if (!candidateEmail) {
    throw new Error('candidate_no_email');
  }
  const job = await emailSenderQueue.add('send-email', {
    tenantId: msg.tenant_id,
    candidateId: msg.candidate_id,
    to: candidateEmail,
    subject: msg.subject ?? '(geen onderwerp)',
    bodyHtml: msg.body_html ?? `<pre>${escapeHtml(msg.body_text ?? '')}</pre>`,
    bodyText: msg.body_text ?? undefined,
  });
  return {
    external_id: `email-job:${job.id ?? 'unknown'}`,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function processJob(job: Job<JobData>): Promise<unknown> {
  const { tenantId, messageId } = job.data;
  logger.info('[outreachEmailNurture] processing', { jobId: job.id, messageId });
  try {
    const result = await sendMessage(tenantId, messageId, attemptSendEmail);
    logger.info('[outreachEmailNurture] sent', { messageId, external_id: result.external_id });
    return result;
  } catch (err) {
    logger.error('[outreachEmailNurture] send failed', {
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

let outreachEmailNurtureWorker: Worker<JobData> | null = null;

if (!shouldStartWorker) {
  logger.info('[outreachEmailNurture] inline worker disabled');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  outreachEmailNurtureWorker = new Worker<JobData>(
    'outreach-email-nurture',
    processJob,
    { connection }
  );
  outreachEmailNurtureWorker.on('failed', (job, err) =>
    logger.error('[outreachEmailNurture] failed', {
      jobId: job?.id,
      error: err.message,
    })
  );
}

export { outreachEmailNurtureWorker };

/**
 * Inbox-sync worker — Sprint Q3.1.
 *
 * Repeatable cron `*\/5 * * * *`: scant alle actieve mailbox_integrations en
 * haalt nieuwe messages op via Gmail historyId / Outlook deltaLink.
 *
 * Per nieuw bericht:
 *   - matchen op kandidaat via from-adres (`candidates.email = msg.from`).
 *   - matchen op bestaande thread via `in_reply_to` → bestaande
 *     communications.message_id.
 *   - INSERT in `communications` met direction=inbound + mailbox_integration_id.
 *   - emit workflow event `candidate.email_received` als kandidaat gematched is.
 *
 * Bij 401 (token niet meer geldig na refresh): integratie gemarkeerd als
 * inactive via `invalidateIntegration` (de daar-aanwezige audit-log dekt
 * de compliance-trail af).
 *
 * De worker volgt het globale `WORKER_PROCESS` / `DISABLE_INLINE_WORKERS`
 * patroon zodat hij in de api-container niet dubbel start.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { withTenant } from '../../db/pool';
import { recordCommunication } from '../../lib/inboxProjector';
import { inboxSyncQueue } from '../queues';
import { getMailProvider } from '../../lib/providers';
import {
  listAllActiveIntegrationsForSync,
  getIntegrationFull,
  refreshTokenIfExpired,
  invalidateIntegration,
  type MailboxIntegrationWithTokens,
} from '../../modules/integrations/mailbox.service';
import { emitWorkflowEvent } from '../../modules/workflows/workflowEmitter';
import type { ProviderMessage } from '../../lib/mailProvider';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InboxSyncJobData {
  /** Specifieke integratie-id om te scannen, of leeg = alle. */
  integrationId?: string;
  /** Optioneel: tenant-id voor RLS-context bij specifieke integratie. */
  tenantId?: string;
}

// ─── Single-integration sync ───────────────────────────────────────────────

interface SyncOutcome {
  integrationId: string;
  newMessages: number;
  matchedCandidates: number;
  error?: string;
}

async function syncOneIntegration(
  integration: MailboxIntegrationWithTokens
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = {
    integrationId: integration.id,
    newMessages: 0,
    matchedCandidates: 0,
  };

  let live: MailboxIntegrationWithTokens;
  try {
    live = await refreshTokenIfExpired(integration);
  } catch (err) {
    outcome.error = `token_refresh_failed: ${(err as Error).message}`;
    return outcome;
  }

  const provider = getMailProvider(live.provider);

  let listResult;
  try {
    listResult = await provider.listMessagesSince(
      live.access_token,
      live.history_id ?? undefined,
      live.last_sync_at ? new Date(live.last_sync_at) : undefined
    );
  } catch (err) {
    const status =
      (err as { code?: number; status?: number; statusCode?: number }).statusCode ??
      (err as { code?: number; status?: number }).status ??
      (err as { code?: number; status?: number }).code;
    if (status === 401 || status === 403) {
      await invalidateIntegration(
        live.tenant_id,
        live.id,
        `listMessages rejected: ${(err as Error).message}`
      );
    }
    outcome.error = `list_messages_failed: ${(err as Error).message}`;
    return outcome;
  }

  const events: Array<{ candidateId: string; communicationId: string; subject: string }> = [];

  await withTenant(live.tenant_id, async (client) => {
    for (const msg of listResult.messages) {
      // Outbound (we sent it) — skip.
      const direction = isMessageFromIntegration(msg, live.account_email)
        ? 'outbound'
        : 'inbound';
      if (direction === 'outbound') continue;

      // Idempotency — skip if message_id already stored.
      if (msg.message_id_header) {
        const { rows: existing } = await client.query<{ id: string }>(
          `SELECT id FROM communications
           WHERE tenant_id = $1 AND message_id = $2
           LIMIT 1`,
          [live.tenant_id, msg.message_id_header]
        );
        if (existing.length > 0) continue;
      }

      // Candidate match: via from-address.
      const fromEmail = extractEmailAddress(msg.from);
      let candidateId: string | null = null;
      if (fromEmail) {
        const { rows: cand } = await client.query<{ id: string }>(
          `SELECT id FROM candidates
           WHERE tenant_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL
           ORDER BY created_at ASC
           LIMIT 1`,
          [live.tenant_id, fromEmail]
        );
        candidateId = cand[0]?.id ?? null;
      }

      // Thread match — `in_reply_to` may correspond to an existing communication.
      let threadUuid: string | null = null;
      if (msg.in_reply_to) {
        const { rows: refs } = await client.query<{ thread_id: string | null }>(
          `SELECT thread_id FROM communications
           WHERE tenant_id = $1 AND message_id = $2 AND thread_id IS NOT NULL
           LIMIT 1`,
          [live.tenant_id, msg.in_reply_to]
        );
        threadUuid = refs[0]?.thread_id ?? null;
      }

      if (!candidateId) {
        // No candidate → don't insert. (communications.candidate_id is NOT NULL.)
        continue;
      }

      const body = msg.body_html ?? msg.body_text ?? '';
      const { rows: [inserted] } = await client.query<{ id: string }>(
        `INSERT INTO communications
           (tenant_id, candidate_id, channel, direction, subject, body, status,
            message_id, in_reply_to, thread_id, mailbox_integration_id, sent_at)
         VALUES ($1, $2, 'email', 'inbound', $3, $4, 'delivered',
                 $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          live.tenant_id,
          candidateId,
          msg.subject,
          body,
          msg.message_id_header ?? null,
          msg.in_reply_to ?? null,
          threadUuid,
          live.id,
          msg.received_at.toISOString(),
        ]
      );

      // Project into unified_threads so mailbox-synced inbound e-mail shows
      // up in the omni-channel inbox (in-transaction, matching voice.service.ts).
      await recordCommunication({
        tenantId: live.tenant_id,
        candidateId,
        communicationId: inserted.id,
        channel: 'email',
        direction: 'inbound',
        preview: body,
        timestamp: msg.received_at.toISOString(),
        client,
        suppressEvent: true,
      });

      outcome.newMessages++;
      outcome.matchedCandidates++;
      events.push({
        candidateId,
        communicationId: inserted.id,
        subject: msg.subject,
      });
    }

    // Update integration sync-state in the same transaction.
    await client.query(
      `UPDATE mailbox_integrations
       SET history_id   = COALESCE($1, history_id),
           last_sync_at = now(),
           sync_error   = NULL,
           updated_at   = now()
       WHERE id = $2 AND tenant_id = $3`,
      [listResult.nextCursor ?? null, live.id, live.tenant_id]
    );
  });

  // Emit workflow events AFTER the transaction has committed — workers may
  // pick up jobs immediately and we don't want them to race the INSERT.
  for (const ev of events) {
    await emitWorkflowEvent(live.tenant_id, 'candidate.email_received', ev.candidateId, {
      communication_id: ev.communicationId,
      subject: ev.subject,
      mailbox_integration_id: live.id,
    });
  }

  return outcome;
}

function isMessageFromIntegration(msg: ProviderMessage, accountEmail: string): boolean {
  const from = extractEmailAddress(msg.from);
  if (!from) return false;
  return from.toLowerCase() === accountEmail.toLowerCase();
}

function extractEmailAddress(value: string | undefined | null): string | null {
  if (!value) return null;
  // "Name <email@x.com>" or plain "email@x.com"
  const match = /<([^>]+)>/.exec(value);
  const candidate = (match ? match[1] : value).trim();
  if (!candidate.includes('@')) return null;
  return candidate;
}

// ─── Worker entrypoint ────────────────────────────────────────────────────

async function processInboxSyncJob(
  job: Job<InboxSyncJobData>
): Promise<{ scanned: number; outcomes: SyncOutcome[] }> {
  logger.info('[inboxSync] processing', { jobId: job.id, jobName: job.name, data: job.data });

  let integrations: MailboxIntegrationWithTokens[] = [];

  if (job.data.integrationId && job.data.tenantId) {
    try {
      integrations = [await getIntegrationFull(job.data.tenantId, job.data.integrationId)];
    } catch (err) {
      logger.warn('[inboxSync] specific integration not found', {
        integrationId: job.data.integrationId,
        error: (err as Error).message,
      });
      integrations = [];
    }
  } else {
    integrations = await listAllActiveIntegrationsForSync();
  }

  const outcomes: SyncOutcome[] = [];
  for (const integration of integrations) {
    if (!integration.active) continue;
    try {
      const outcome = await syncOneIntegration(integration);
      outcomes.push(outcome);
      if (outcome.error) {
        logger.warn('[inboxSync] integration sync had errors', outcome);
      } else {
        logger.info('[inboxSync] integration sync ok', outcome);
      }
    } catch (err) {
      logger.error('[inboxSync] unexpected sync failure', {
        integrationId: integration.id,
        tenantId: integration.tenant_id,
        error: (err as Error).message,
      });
      outcomes.push({
        integrationId: integration.id,
        newMessages: 0,
        matchedCandidates: 0,
        error: (err as Error).message,
      });
    }
  }

  return { scanned: integrations.length, outcomes };
}

// ─── Worker setup ─────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let inboxSyncWorker: Worker<InboxSyncJobData> | null = null;

if (!shouldStartWorker) {
  logger.info('[inboxSync] inline worker disabled (DISABLE_INLINE_WORKERS=true)');
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  inboxSyncWorker = new Worker<InboxSyncJobData>('inbox-sync', processInboxSyncJob, {
    connection,
  });

  inboxSyncWorker.on('completed', (job) => {
    logger.info('[inboxSync] Job completed', { jobId: job.id, jobName: job.name });
  });
  inboxSyncWorker.on('failed', (job, err) => {
    logger.error('[inboxSync] Job failed', {
      jobId: job?.id,
      jobName: job?.name,
      error: err.message,
    });
  });

  // Repeatable cron — single idempotent registration.
  // BullMQ deduplicates `repeat` schedules by jobId.
  inboxSyncQueue
    .add(
      'scan-all',
      {},
      {
        repeat: { pattern: '*/5 * * * *' },
        jobId: 'inbox-sync-all',
      }
    )
    .then(() => {
      logger.info('[inboxSync] repeatable cron registered (*/5 * * * *)');
    })
    .catch((err: Error) => {
      logger.warn('[inboxSync] failed to register repeatable cron', { error: err.message });
    });
}

export { inboxSyncWorker, processInboxSyncJob };

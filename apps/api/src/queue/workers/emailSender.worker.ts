import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { sendEmail } from '../../lib/emailService';
import { sendTenantEmail } from '../../lib/tenantMailer';
import { withTenant } from '../../db/pool';
import { sendEmailViaIntegration } from '../../modules/integrations/mailbox.service';
import { recordBulkRecipientResult } from '../../modules/communications/bulkCampaign.service';
import { eventBus } from '../../lib/eventBus';
import { truncatePreview } from '../../lib/inboxProjector';

// ─── Job data ────────────────────────────────────────────────────────────────

export interface EmailJobData {
  tenantId?: string;
  candidateId?: string;
  templateId?: string;
  to: string;
  subject: string;
  /** Post-merge HTML body (preferred). Backwards-compat: oude jobs sturen `body`. */
  bodyHtml?: string;
  bodyText?: string;
  /** Legacy field — used when bodyHtml is missing (forgot-password / user-invitation). */
  body?: string;
  threadId?: string;
  inReplyTo?: string;
  userId?: string;
  /**
   * Optional id of a `communications` row pre-inserted by the producer
   * (e.g. `enqueueOutboundEmail` writes `status='queued'` first). When set,
   * the worker UPDATES that row instead of inserting a new one — preventing
   * duplicate rows for the same email.
   */
  communicationId?: string;
  /**
   * Sprint Q3.1 — als gezet, verstuur via persoonlijke mailbox-integratie
   * (Gmail/Outlook OAuth) i.p.v. de transactionele Resend-flow.
   */
  mailboxIntegrationId?: string;
  /**
   * Sprint Q3.1 — koppel deze job aan een bulk-campaign zodat de worker de
   * recipient-status terug kan rapporteren.
   */
  campaignId?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildReplyTo(tenantId: string, threadId: string): string | undefined {
  const domain = process.env.RESEND_REPLY_DOMAIN;
  if (!domain) return undefined;
  // Plus-addressing: reply+<tenantId>+<threadId>@<domain>.
  // RFC 5321 staat max 64 tekens toe in het local-part. Twee volle UUID's + prefix = 79,
  // waardoor Resend de HELE mail weigert ("Invalid reply_to field"). Sla reply-to dan over
  // i.p.v. de verzending te blokkeren — inbound reply-threading is nog niet actief
  // (geen geverifieerd reply-domein/MX/webhook; zie ROADMAP Sectie 6).
  const localPart = `reply+${tenantId}+${threadId}`;
  if (localPart.length > 64) return undefined;
  return `${localPart}@${domain}`;
}

function ensureHtml(data: EmailJobData): string {
  if (data.bodyHtml && data.bodyHtml.trim().length > 0) return data.bodyHtml;
  if (data.body) {
    // Wrap legacy plain-text bodies in een minimale HTML-omhulling.
    const escaped = data.body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br />');
    return `<p>${escaped}</p>`;
  }
  return '';
}

function ensureText(data: EmailJobData): string | undefined {
  if (data.bodyText && data.bodyText.trim().length > 0) return data.bodyText;
  if (data.body) return data.body;
  return undefined;
}

// ─── Job processor ──────────────────────────────────────────────────────────

async function processEmailJob(job: Job<EmailJobData>): Promise<unknown> {
  const data = job.data;
  logger.info('[emailSender] verwerk job', {
    jobId: job.id,
    jobName: job.name,
    to: data.to,
    subject: data.subject,
    tenantId: data.tenantId,
    candidateId: data.candidateId,
    templateId: data.templateId,
  });

  // Geen tenant-context (oude callers zoals forgot-password): direct versturen
  // zonder communications/threads-administratie.
  if (!data.tenantId) {
    const html = ensureHtml(data);
    const text = ensureText(data);
    const result = await sendEmail({
      to: data.to,
      subject: data.subject,
      html,
      text,
    });
    logger.info('[emailSender] simpele e-mail verzonden (geen tenant)', {
      jobId: job.id,
      messageId: result.messageId,
      mocked: result.mocked,
    });
    return { sent: true, ...result };
  }

  const tenantId = data.tenantId;

  // ── Sprint Q3.1 — dispatch via persoonlijke mailbox-integratie ──────────
  // Als de producer (bv. bulkCampaign.service voor `via=mailbox_integration`)
  // een mailbox_integration_id meegeeft, delegeren we de daadwerkelijke send
  // naar mailbox.service.sendEmailViaIntegration. Die service inserteert zelf
  // de communications-rij (met mailbox_integration_id), zodat we hier verder
  // niets meer hoeven te doen behalve campaign-tracking.
  if (data.mailboxIntegrationId) {
    try {
      const html = ensureHtml(data);
      const result = await sendEmailViaIntegration(
        tenantId,
        data.mailboxIntegrationId,
        data.userId ?? '00000000-0000-0000-0000-000000000000',
        {
          to: data.to,
          subject: data.subject,
          html,
          threadId: data.threadId,
          inReplyTo: data.inReplyTo,
          candidateId: data.candidateId,
        }
      );
      if (data.campaignId && data.candidateId) {
        await recordBulkRecipientResult(
          tenantId,
          data.campaignId,
          data.candidateId,
          'sent',
          undefined,
          data.userId
        );
      }
      logger.info('[emailSender] mailbox-integratie send ok', {
        jobId: job.id,
        integrationId: data.mailboxIntegrationId,
        messageId: result.messageId,
      });
      return { sent: true, via: 'mailbox_integration', ...result };
    } catch (err) {
      if (data.campaignId && data.candidateId) {
        await recordBulkRecipientResult(
          tenantId,
          data.campaignId,
          data.candidateId,
          'failed',
          (err as Error).message,
          data.userId
        );
      }
      logger.error('[emailSender] mailbox-integratie send mislukt', {
        jobId: job.id,
        integrationId: data.mailboxIntegrationId,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  try {
    return await withTenant(tenantId, async (client) => {
      // 1) Thread-id vinden of nieuw aanmaken (alleen als we kandidaat hebben).
      let threadId = data.threadId ?? null;

      if (!threadId && data.candidateId) {
        const { rows: [thread] } = await client.query<{ id: string }>(
          `INSERT INTO email_threads (tenant_id, candidate_id, subject, last_message_at)
           VALUES ($1, $2, $3, now())
           RETURNING id`,
          [tenantId, data.candidateId, data.subject]
        );
        threadId = thread.id;
      } else if (threadId) {
        // Bestaande thread: bump last_message_at.
        await client.query(
          `UPDATE email_threads SET last_message_at = now()
           WHERE id = $1 AND tenant_id = $2`,
          [threadId, tenantId]
        );
      }

      // 2) Reply-To bouwen (plus-addressing) als we een thread hebben.
      //    Let op: een per-tenant `reply_to` (tenant_email_settings) wint in
      //    sendTenantEmail van deze plus-addressing Reply-To.
      const replyTo = threadId ? buildReplyTo(tenantId, threadId) : undefined;

      // 3) Versturen — tenant-aware transport: eigen SMTP indien enabled,
      //    anders Resend met per-tenant afzendernaam (zie lib/tenantMailer.ts).
      const html = ensureHtml(data);
      const text = ensureText(data);
      let sendResult;
      try {
        sendResult = await sendTenantEmail(tenantId, {
          to: data.to,
          subject: data.subject,
          html,
          text,
          replyTo,
          inReplyTo: data.inReplyTo,
        });
      } catch (sendErr) {
        // Mark the email as failed so BullMQ retry kicks in. Prefer UPDATE
        // when the producer pre-inserted a `queued` row; fall back to INSERT
        // for direct producers that didn't.
        if (data.communicationId) {
          await client.query(
            `UPDATE communications
             SET status = 'failed', error_message = $1, thread_id = COALESCE(thread_id, $2)
             WHERE id = $3 AND tenant_id = $4`,
            [(sendErr as Error).message, threadId, data.communicationId, tenantId]
          );
        } else if (data.candidateId) {
          await client.query(
            `INSERT INTO communications
               (tenant_id, candidate_id, channel, direction, subject, body, status,
                in_reply_to, thread_id, template_id, error_message)
             VALUES ($1, $2, 'email', 'outbound', $3, $4, 'failed', $5, $6, $7, $8)`,
            [
              tenantId,
              data.candidateId,
              data.subject,
              html,
              data.inReplyTo ?? null,
              threadId,
              data.templateId ?? null,
              (sendErr as Error).message,
            ]
          );
        }
        throw sendErr;
      }

      // 4) Communications-rij vastleggen — UPDATE pre-inserted queued-rij of INSERT nieuwe.
      if (data.communicationId) {
        await client.query(
          `UPDATE communications
           SET status = 'sent', message_id = $1, thread_id = COALESCE(thread_id, $2),
               sent_at = now()
           WHERE id = $3 AND tenant_id = $4`,
          [sendResult.messageId, threadId, data.communicationId, tenantId]
        );
      } else if (data.candidateId) {
        await client.query(
          `INSERT INTO communications
             (tenant_id, candidate_id, channel, direction, subject, body, status,
              message_id, in_reply_to, thread_id, template_id)
           VALUES ($1, $2, 'email', 'outbound', $3, $4, 'sent', $5, $6, $7, $8)`,
          [
            tenantId,
            data.candidateId,
            data.subject,
            html,
            sendResult.messageId,
            data.inReplyTo ?? null,
            threadId,
            data.templateId ?? null,
          ]
        );
      }
      if (data.candidateId) {

        // 5) Activity log — fire-and-forget binnen de transactie.
        if (data.userId) {
          client.query(
            `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
             VALUES ($1, 'candidate', $2, $3, 'email_sent', $4)`,
            [
              tenantId,
              data.candidateId,
              data.userId,
              JSON.stringify({
                subject: data.subject,
                template_id: data.templateId ?? null,
                thread_id: threadId,
                message_id: sendResult.messageId,
              }),
            ]
          ).catch((actErr: Error) => {
            logger.warn('[emailSender] activity log insert failed', { error: actErr.message });
          });
        }
      }

      // Q4.6 omni-channel inbox hook — emit so inboxProjector updates
      // `unified_threads` for the candidate. Safe to skip if no candidate.
      if (data.candidateId && data.communicationId) {
        eventBus.emit('communicationCreated', {
          tenantId,
          candidateId: data.candidateId,
          communicationId: data.communicationId,
          channel: 'email',
          direction: 'outbound',
          preview: truncatePreview(data.bodyText ?? data.subject ?? ''),
          timestamp: new Date().toISOString(),
        });
      }

      logger.info('[emailSender] e-mail verzonden', {
        jobId: job.id,
        messageId: sendResult.messageId,
        mocked: sendResult.mocked,
        threadId,
      });

      return { sent: true, threadId, ...sendResult };
    }).then(async (result) => {
      // Sprint Q3.1 — bulk-campaign tracking (Resend path).
      if (data.campaignId && data.candidateId) {
        await recordBulkRecipientResult(
          tenantId,
          data.campaignId,
          data.candidateId,
          'sent',
          undefined,
          data.userId
        );
      }
      return result;
    });
  } catch (err) {
    if (data.campaignId && data.candidateId) {
      await recordBulkRecipientResult(
        tenantId,
        data.campaignId,
        data.candidateId,
        'failed',
        (err as Error).message,
        data.userId
      );
    }
    logger.error('[emailSender] verzending mislukt', {
      jobId: job.id,
      tenantId,
      to: data.to,
      error: (err as Error).message,
    });
    throw err;
  }
}

// ─── Worker setup ───────────────────────────────────────────────────────────

// DISABLE_INLINE_WORKERS guard — zie resumeParser.worker.ts voor details.
const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let emailSenderWorker: Worker<EmailJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[emailSender] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  emailSenderWorker = new Worker<EmailJobData>(
    'email-sender',
    processEmailJob,
    { connection }
  );

  emailSenderWorker.on('completed', (job) => {
    logger.info('[emailSender] Job completed', { jobId: job.id });
  });

  emailSenderWorker.on('failed', (job, err) => {
    logger.error('[emailSender] Job failed', { jobId: job?.id, error: err.message });
  });
}

export { emailSenderWorker };

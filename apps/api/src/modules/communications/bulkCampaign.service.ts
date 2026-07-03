/**
 * Bulk-campaign service — Sprint Q3.1.
 *
 * Verstuurt een batch e-mails naar een expliciete kandidatenlijst, met:
 *   - GDPR-respect: kandidaten zonder `email_consent = TRUE` worden geskipt
 *     en geteld als `total_skipped_consent`.
 *   - Rate-limiting: 1 mail / sec / verstuurder via BullMQ delay (i*1000ms).
 *   - Audit: `BULK_CAMPAIGN_STARTED` aan het begin, `BULK_CAMPAIGN_COMPLETED`
 *     wordt geëmit door de email-sender / bulk-mail worker zodra alle
 *     recipients hun terminal status hebben.
 *
 * Twee `via`-modi:
 *   - `resend`: de transactional Resend-flow via `emailSenderQueue`. Gebruikt
 *     dezelfde worker als gewone email-jobs.
 *   - `mailbox_integration`: enqueued op dezelfde queue, maar met
 *     `mailbox_integration_id` in de payload — de emailSender-worker delegeert
 *     naar `mailbox.service.sendEmailViaIntegration`.
 */

import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { emailSenderQueue } from '../../queue/queues';
import { logAudit } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { applyMergeVars } from '../../lib/mergeVariables';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BulkCampaignInput {
  candidate_ids: string[];
  subject: string;
  body_html: string;
  template_id?: string;
  via: 'resend' | 'mailbox_integration';
  mailbox_integration_id?: string;
}

export interface BulkCampaignStartResult {
  campaign_id: string;
  total_eligible: number;
  total_skipped_consent: number;
}

export interface BulkCampaign {
  id: string;
  tenant_id: string;
  user_id: string;
  subject: string;
  body_html: string;
  template_id: string | null;
  via: 'resend' | 'mailbox_integration';
  mailbox_integration_id: string | null;
  total_eligible: number;
  total_skipped_consent: number;
  total_sent: number;
  total_failed: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  started_at: string;
  completed_at: string | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const RATE_LIMIT_MS = 1000; // 1 email / second / campaign

// ─── Start campaign ────────────────────────────────────────────────────────

export async function startBulkCampaign(
  tenantId: string,
  userId: string,
  input: BulkCampaignInput
): Promise<BulkCampaignStartResult> {
  if (input.candidate_ids.length === 0) {
    throw new AppError(400, 'NO_RECIPIENTS', 'Geen kandidaten opgegeven');
  }
  if (input.candidate_ids.length > 5000) {
    throw new AppError(400, 'TOO_MANY_RECIPIENTS', 'Maximaal 5000 ontvangers per campagne');
  }
  if (input.via === 'mailbox_integration' && !input.mailbox_integration_id) {
    throw new AppError(
      400,
      'MISSING_MAILBOX_INTEGRATION',
      'mailbox_integration_id verplicht bij via=mailbox_integration'
    );
  }

  // Step 1: filter eligible (consent) and prepare insert in single transaction.
  const { campaign, eligible, skipped, tenantName } = await withTenant(tenantId, async (client) => {
    // Validate mailbox-integration belongs to this tenant + active.
    if (input.via === 'mailbox_integration' && input.mailbox_integration_id) {
      const { rows: [mb] } = await client.query<{ id: string; active: boolean }>(
        `SELECT id, active FROM mailbox_integrations
         WHERE id = $1 AND tenant_id = $2`,
        [input.mailbox_integration_id, tenantId]
      );
      if (!mb) {
        throw new AppError(404, 'INTEGRATION_NOT_FOUND', 'Mailbox-integratie niet gevonden');
      }
      if (!mb.active) {
        throw new AppError(409, 'INTEGRATION_INACTIVE', 'Mailbox-integratie is inactief');
      }
    }

    // Lookup all candidates in scope. first_name/last_name zijn nodig voor
    // de merge-variabelen ({{candidate.first_name}}) in het enqueue-pad.
    const { rows: candidates } = await client.query<{
      id: string;
      email: string | null;
      name: string;
      first_name: string | null;
      last_name: string | null;
      email_consent: boolean | null;
    }>(
      `SELECT id, email, name, first_name, last_name, email_consent
       FROM candidates
       WHERE tenant_id = $1
         AND id = ANY($2::uuid[])
         AND deleted_at IS NULL`,
      [tenantId, input.candidate_ids]
    );

    // Tenant-naam voor {{tenant.name}} (één lookup voor de hele campagne).
    const { rows: [tenantRow] } = await client.query<{ name: string }>(
      'SELECT name FROM tenants WHERE id = $1',
      [tenantId]
    );

    const eligibleList = candidates.filter(
      (c) => c.email_consent === true && c.email !== null && c.email !== ''
    );
    const skippedCount = candidates.length - eligibleList.length;

    const { rows: [campaignRow] } = await client.query<BulkCampaign>(
      `INSERT INTO bulk_campaigns
         (tenant_id, user_id, subject, body_html, template_id, via,
          mailbox_integration_id, total_eligible, total_skipped_consent, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'running')
       RETURNING *`,
      [
        tenantId,
        userId,
        input.subject,
        input.body_html,
        input.template_id ?? null,
        input.via,
        input.mailbox_integration_id ?? null,
        eligibleList.length,
        skippedCount,
      ]
    );

    // Insert per-recipient rows for tracking.
    if (eligibleList.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [tenantId, campaignRow.id];
      eligibleList.forEach((c, i) => {
        values.push(`($1, $2, $${i + 3}, 'queued')`);
        params.push(c.id);
      });
      await client.query(
        `INSERT INTO bulk_campaign_recipients
           (tenant_id, campaign_id, candidate_id, status)
         VALUES ${values.join(', ')}`,
        params
      );
    }

    // Track the skipped ones too (for audit/report).
    const skippedCandidates = candidates.filter(
      (c) => c.email_consent !== true || !c.email
    );
    if (skippedCandidates.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [tenantId, campaignRow.id];
      skippedCandidates.forEach((c, i) => {
        values.push(`($1, $2, $${i + 3}, 'skipped_no_consent')`);
        params.push(c.id);
      });
      await client.query(
        `INSERT INTO bulk_campaign_recipients
           (tenant_id, campaign_id, candidate_id, status)
         VALUES ${values.join(', ')}
         ON CONFLICT (campaign_id, candidate_id) DO NOTHING`,
        params
      );
    }

    await logAudit(client, tenantId, {
      action: AuditActions.BULK_CAMPAIGN_STARTED,
      entityType: 'bulk_campaign',
      entityId: campaignRow.id,
      userId,
      after: {
        via: input.via,
        total_eligible: eligibleList.length,
        total_skipped_consent: skippedCount,
        subject: input.subject,
      },
    });

    return {
      campaign: campaignRow,
      eligible: eligibleList,
      skipped: skippedCount,
      tenantName: tenantRow?.name ?? '',
    };
  });

  // Step 2: enqueue jobs OUTSIDE the transaction so a slow Redis doesn't
  // hold a Postgres connection. Rate-limited via per-job delay.
  for (let i = 0; i < eligible.length; i++) {
    const candidate = eligible[i];
    if (!candidate.email) continue;
    // Merge-variabelen per ontvanger: de worker verwacht post-merge HTML
    // (zie emailSender.worker.ts) — zonder deze stap zou elke kandidaat
    // letterlijk "{{candidate.first_name}}" in de mail zien.
    const mergeCtx = {
      candidate,
      tenant: { name: tenantName },
    };
    try {
      await emailSenderQueue.add(
        'send-email',
        {
          tenantId,
          candidateId: candidate.id,
          templateId: input.template_id,
          to: candidate.email,
          subject: applyMergeVars(input.subject, mergeCtx),
          bodyHtml: applyMergeVars(input.body_html, mergeCtx),
          userId,
          mailboxIntegrationId:
            input.via === 'mailbox_integration' ? input.mailbox_integration_id : undefined,
          campaignId: campaign.id,
        },
        {
          delay: i * RATE_LIMIT_MS,
        }
      );
    } catch (err) {
      logger.error('[bulkCampaign] failed to enqueue', {
        campaignId: campaign.id,
        candidateId: candidate.id,
        error: (err as Error).message,
      });
    }
  }

  return {
    campaign_id: campaign.id,
    total_eligible: eligible.length,
    total_skipped_consent: skipped,
  };
}

// ─── Listing + detail ──────────────────────────────────────────────────────

export async function listBulkCampaigns(
  tenantId: string,
  limit = 50
): Promise<BulkCampaign[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<BulkCampaign>(
      `SELECT * FROM bulk_campaigns
       WHERE tenant_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [tenantId, safeLimit]
    );
    return rows;
  });
}

export async function getBulkCampaign(
  tenantId: string,
  campaignId: string
): Promise<BulkCampaign> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<BulkCampaign>(
      `SELECT * FROM bulk_campaigns
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, campaignId]
    );
    if (!row) {
      throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campagne niet gevonden');
    }
    return row;
  });
}

// ─── Worker-callbacks (used by emailSender.worker) ─────────────────────────

/**
 * Geroepen door de email-sender worker zodra een bulk-recipient terminale
 * status (sent / failed) heeft. Updatet de aggregate-counters en zet de
 * campaign op `completed` als de laatste recipient verwerkt is.
 *
 * Faal-modus: een fout hier mag de mail-job niet falen — alleen loggen.
 */
export async function recordBulkRecipientResult(
  tenantId: string,
  campaignId: string,
  candidateId: string,
  status: 'sent' | 'failed',
  errorMessage?: string,
  userId?: string
): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE bulk_campaign_recipients
         SET status = $1, error_message = $2, sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END
         WHERE tenant_id = $3 AND campaign_id = $4 AND candidate_id = $5`,
        [status, errorMessage ?? null, tenantId, campaignId, candidateId]
      );

      const counterCol = status === 'sent' ? 'total_sent' : 'total_failed';
      await client.query(
        `UPDATE bulk_campaigns
         SET ${counterCol} = ${counterCol} + 1
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, campaignId]
      );

      // Check if completed.
      const { rows: [campaign] } = await client.query<{
        total_eligible: number;
        total_sent: number;
        total_failed: number;
        status: string;
      }>(
        `SELECT total_eligible, total_sent, total_failed, status
         FROM bulk_campaigns
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, campaignId]
      );
      if (
        campaign &&
        campaign.status === 'running' &&
        campaign.total_sent + campaign.total_failed >= campaign.total_eligible
      ) {
        await client.query(
          `UPDATE bulk_campaigns
           SET status = 'completed', completed_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, campaignId]
        );
        await logAudit(client, tenantId, {
          action: AuditActions.BULK_CAMPAIGN_COMPLETED,
          entityType: 'bulk_campaign',
          entityId: campaignId,
          userId: userId ?? null,
          after: {
            total_sent: campaign.total_sent + (status === 'sent' ? 1 : 0),
            total_failed: campaign.total_failed + (status === 'failed' ? 1 : 0),
          },
        });
      }
    });
  } catch (err) {
    logger.warn('[bulkCampaign] recordBulkRecipientResult failed', {
      campaignId,
      candidateId,
      status,
      error: (err as Error).message,
    });
  }
}

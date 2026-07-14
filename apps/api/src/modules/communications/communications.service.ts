import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { emailSenderQueue } from '../../queue/queues';

export interface SendMessageData {
  candidate_id: string;
  channel: 'email' | 'whatsapp' | 'sms';
  body: string;
  subject?: string;
}

export interface Communication {
  id: string;
  tenant_id: string;
  candidate_id: string;
  channel: 'email' | 'whatsapp' | 'sms';
  direction: 'inbound' | 'outbound';
  subject: string | null;
  body: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  sent_at: string;
  created_at: string;
  candidate_name?: string;
}

export async function getCandidateCommunications(
  tenantId: string,
  candidateId: string
): Promise<Communication[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Communication>(
      `SELECT * FROM communications
       WHERE tenant_id = $1 AND candidate_id = $2
       ORDER BY sent_at DESC`,
      [tenantId, candidateId]
    );
    return rows;
  });
}

export async function getInbox(
  tenantId: string,
  opts: { channel?: string; limit?: number } = {}
): Promise<Communication[]> {
  return withTenant(tenantId, async (client) => {
    const limit = opts.limit ?? 50;
    const values: unknown[] = [tenantId];
    let channelClause = '';

    if (opts.channel) {
      channelClause = `AND c.channel = $2`;
      values.push(opts.channel);
    }

    values.push(limit);
    const limitParam = `$${values.length}`;

    const { rows } = await client.query<Communication>(
      `SELECT c.*, cand.name as candidate_name
       FROM communications c
       JOIN candidates cand ON cand.id = c.candidate_id
       WHERE c.tenant_id = $1 ${channelClause}
       ORDER BY c.sent_at DESC
       LIMIT ${limitParam}`,
      values
    );
    return rows;
  });
}

/**
 * Outbound transactional email via Resend (Slice 3 path).
 *
 * Verifies the candidate exists + has an email address, inserts a `queued`
 * row in `communications`, and enqueues the message on `emailSenderQueue`
 * so the worker handles delivery + threading. The returned row has
 * `status = 'queued'` and is updated to `sent`/`failed` by the worker.
 */
export interface EnqueueEmailInput {
  candidate_id: string;
  template_id?: string;
  subject: string;
  body_html: string;
  body_text?: string;
}

export async function enqueueOutboundEmail(
  tenantId: string,
  userId: string,
  input: EnqueueEmailInput
): Promise<Communication> {
  return withTenant(tenantId, async (client) => {
    const { rows: [candidate] } = await client.query<{
      id: string;
      email: string | null;
      name: string;
    }>(
      `SELECT id, email, name FROM candidates
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [input.candidate_id, tenantId]
    );
    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }
    if (!candidate.email) {
      throw new AppError(400, 'CANDIDATE_NO_EMAIL', 'Kandidaat heeft geen e-mailadres');
    }

    const { rows: [communication] } = await client.query<Communication>(
      `INSERT INTO communications
         (tenant_id, candidate_id, channel, direction, subject, body, status, template_id)
       VALUES ($1, $2, 'email', 'outbound', $3, $4, 'queued', $5)
       RETURNING *`,
      [
        tenantId,
        input.candidate_id,
        input.subject,
        input.body_html,
        input.template_id ?? null,
      ]
    );

    await emailSenderQueue.add('send-email', {
      tenantId,
      candidateId: input.candidate_id,
      templateId: input.template_id,
      to: candidate.email,
      subject: input.subject,
      bodyHtml: input.body_html,
      bodyText: input.body_text,
      userId,
      communicationId: communication.id,
    });

    client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'candidate', $2, $3, 'email_queued', $4)`,
      [
        tenantId,
        input.candidate_id,
        userId,
        JSON.stringify({ subject: input.subject, template_id: input.template_id ?? null }),
      ]
    ).catch((actErr: Error) => {
      logger.warn('[communications] activity log insert failed', { error: actErr.message });
    });

    return communication;
  });
}

export async function sendMessage(
  tenantId: string,
  userId: string,
  data: SendMessageData
): Promise<Communication> {
  // E-mail loopt via de échte emailSender-queue — zelfde pad als
  // enqueueOutboundEmail / POST /communications/send. We schrijven een
  // `queued`-rij en de worker flipt 'm naar `sent`/`failed`. NOOIT een
  // `sent`-status fabriceren zonder daadwerkelijke verzending.
  if (data.channel === 'email') {
    return withTenant(tenantId, async (client) => {
      const { rows: [candidate] } = await client.query<{
        id: string;
        email: string | null;
        name: string;
      }>(
        `SELECT id, email, name FROM candidates
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [data.candidate_id, tenantId]
      );
      if (!candidate) {
        throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
      }
      if (!candidate.email) {
        throw new AppError(400, 'CANDIDATE_NO_EMAIL', 'Kandidaat heeft geen e-mailadres');
      }

      const { rows: [communication] } = await client.query<Communication>(
        `INSERT INTO communications
           (tenant_id, candidate_id, channel, direction, subject, body, status)
         VALUES ($1, $2, 'email', 'outbound', $3, $4, 'queued')
         RETURNING *`,
        [tenantId, data.candidate_id, data.subject ?? null, data.body]
      );

      await emailSenderQueue.add('send-email', {
        tenantId,
        candidateId: data.candidate_id,
        to: candidate.email,
        subject: data.subject ?? '',
        bodyHtml: data.body,
        userId,
        communicationId: communication.id,
      });

      // Activity log — fire and forget.
      client.query(
        `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
         VALUES ($1, 'candidate', $2, $3, 'email_queued', $4)`,
        [
          tenantId,
          data.candidate_id,
          userId,
          JSON.stringify({ channel: 'email', subject: data.subject ?? null }),
        ]
      ).catch((actErr: Error) => {
        logger.warn('[communications] activity log insert failed', { error: actErr.message });
      });

      return communication;
    });
  }

  // WhatsApp/SMS blijven geparkeerd: er is (nog) geen provider-integratie voor
  // deze kanalen in dit pad, dus we leggen de uitgaande boodschap enkel vast.
  return withTenant(tenantId, async (client) => {
    const { rows: [communication] } = await client.query<Communication>(
      `INSERT INTO communications
         (tenant_id, candidate_id, channel, direction, subject, body, status)
       VALUES ($1, $2, $3, 'outbound', $4, $5, 'sent')
       RETURNING *`,
      [
        tenantId,
        data.candidate_id,
        data.channel,
        data.subject ?? null,
        data.body,
      ]
    );

    // Log activity — fire and forget; don't let a missing activities table block the response
    client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'candidate', $2, $3, 'message_sent', $4)`,
      [
        tenantId,
        data.candidate_id,
        userId,
        JSON.stringify({ channel: data.channel, subject: data.subject }),
      ]
    ).catch((actErr: Error) => {
      logger.warn('[communications] activity log insert failed', { error: actErr.message });
    });

    return communication;
  });
}

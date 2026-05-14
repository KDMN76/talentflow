/**
 * Outreach service — Sprint Q4.5 (Agent XXX).
 *
 * Owns the lifecycle of `outreach_messages`: drafting via Claude (with
 * mock-mode), recruiter approval/rejection, channel-specific sending,
 * recording inbound replies, and quota enforcement. Also subscribes to
 * Agent WWW's `findingApproved` event to auto-enroll candidates in the
 * tenant default sequence if configured.
 *
 * State machine for an outbound message:
 *
 *   drafted ──► pending_approval ──► approved ──► sending ──► sent
 *      │              │                  │           └──► failed
 *      │              └──► rejected_by_recruiter
 *      └──► (auto-approved when step.ai_personalize=false) ──► sending
 *
 * Append-only invariant: once `sent_at` is set, the row may not change
 * `body_text`, `body_html`, `subject`, or `sent_at`. Enforced at DB level by
 * the trigger in 030_outreach_and_nurture.sql.
 *
 * Quota enforcement: per (tenant, recruiter, channel) we keep daily +
 * weekly counters in `outreach_quotas`. Atomic increment via SQL
 * `UPDATE … RETURNING current_day_count` so concurrent sends cannot bypass
 * the cap. If the row doesn't exist yet we insert with default limits.
 */

import type { PoolClient } from 'pg';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { logAIEvent } from '../../lib/aiEvents';
import { applyMergeVars, type MergeContext } from '../../lib/mergeVariables';
import {
  outreachLinkedInQueue,
  outreachEmailNurtureQueue,
  replyClassificationQueue,
} from '../../queue/queues';
import { eventBus, type FindingApprovedPayload } from '../../lib/eventBus';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type OutreachChannel =
  | 'linkedin_inmail'
  | 'linkedin_connection'
  | 'email'
  | 'sms'
  | 'whatsapp';

export type OutreachStatus =
  | 'drafted'
  | 'pending_approval'
  | 'approved'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'rejected_by_recruiter';

export type OutreachDirection = 'outbound' | 'inbound';

export interface OutreachMessageRow {
  id: string;
  tenant_id: string;
  enrollment_id: string | null;
  step_id: string | null;
  candidate_id: string;
  channel: OutreachChannel;
  direction: OutreachDirection;
  status: OutreachStatus;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  ai_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  personalization_signals: Record<string, unknown>;
  scheduled_for: string | null;
  sent_at: string | null;
  external_id: string | null;
  external_thread_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  reply_message_id: string | null;
  error_message: string | null;
  retry_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DraftStepConfig {
  channel: OutreachChannel;
  template_subject?: string | null;
  template_body?: string | null;
  ai_personalize?: boolean;
  step_id?: string | null;
  enrollment_id?: string | null;
}

export interface DraftSignals {
  recent_company?: string;
  recent_title?: string;
  common_connection?: string;
  brief_role?: string;
  brief_keywords?: string[];
  recruiter_name?: string;
  tenant_name?: string;
  reactivation_reason?: string;
  [k: string]: unknown;
}

export interface DraftedMessage {
  message: OutreachMessageRow;
  mocked: boolean;
}

export interface QuotaRow {
  id: string;
  tenant_id: string;
  recruiter_id: string;
  channel: OutreachChannel;
  daily_limit: number;
  weekly_limit: number;
  current_day_count: number;
  current_week_count: number;
  reset_day_at: string | null;
  reset_week_at: string | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────────

const PRIMARY_MODEL =
  process.env.OUTREACH_AI_MODEL ?? 'claude-opus-4-7';
const DEFAULT_DAILY_LIMIT = 100;
const DEFAULT_WEEKLY_LIMIT = 500;

// ───────────────────────────────────────────────────────────────────────────
// AI client (lazy)
// ───────────────────────────────────────────────────────────────────────────

let cachedClient: unknown = null;
type AnthropicMessage = {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};
type AnthropicLike = {
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: string; content: string }>;
    }) => Promise<AnthropicMessage>;
  };
};

async function getAnthropicClient(): Promise<AnthropicLike> {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY ontbreekt: vereist voor outreach AI in productie.'
      );
    }
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient as AnthropicLike;
}

function shouldUseMock(): boolean {
  if (process.env.AI_MOCK === 'true') return true;
  if (process.env.ANTHROPIC_API_KEY) return false;
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// Drafting — Claude or deterministic mock
// ───────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_BASE =
  'Je bent een Nederlandstalige recruitment-AI die kort, persoonlijk en respectvol outreach-berichten schrijft naar passieve kandidaten. Schrijf in de taal van de kandidaat (default Nederlands). Toon: warm en professioneel. Vermijd holle marketing-frases. Antwoord UITSLUITEND met een geldig JSON-object: { "subject": "...", "body_text": "..." }. Geen markdown-fences, geen begeleidende tekst.';

function buildUserPrompt(
  candidate: { name?: string | null; first_name?: string | null; email?: string | null },
  signals: DraftSignals,
  template?: { subject?: string | null; body?: string | null } | null
): string {
  const lines: string[] = [];
  lines.push(`Kandidaat: ${candidate.first_name ?? candidate.name ?? 'onbekend'}`);
  if (signals.recent_company) lines.push(`Huidige werkgever: ${signals.recent_company}`);
  if (signals.recent_title) lines.push(`Huidige rol: ${signals.recent_title}`);
  if (signals.common_connection) lines.push(`Gedeelde connectie: ${signals.common_connection}`);
  if (signals.brief_role) lines.push(`Open rol bij ons: ${signals.brief_role}`);
  if (signals.brief_keywords && signals.brief_keywords.length > 0) {
    lines.push(`Match-trefwoorden: ${signals.brief_keywords.join(', ')}`);
  }
  if (signals.reactivation_reason) lines.push(`Reden contact: ${signals.reactivation_reason}`);
  if (template?.subject || template?.body) {
    lines.push('', 'Template (mag aangepast worden voor personalisatie):');
    if (template.subject) lines.push(`Onderwerp-template: ${template.subject}`);
    if (template.body) lines.push(`Body-template: ${template.body}`);
  }
  return lines.join('\n');
}

function extractJson(raw: string): unknown {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`outreach.ai: geen JSON gevonden (preview: ${raw.slice(0, 200)})`);
  }
  return JSON.parse(raw.slice(first, last + 1));
}

interface MockOrAiResult {
  subject: string;
  body_text: string;
  promptTokens?: number;
  completionTokens?: number;
  modelUsed: string;
  mocked: boolean;
}

function buildMockDraft(
  candidate: { first_name?: string | null; name?: string | null },
  signals: DraftSignals,
  channel: OutreachChannel,
  template?: { subject?: string | null; body?: string | null } | null
): { subject: string; body_text: string } {
  const firstName = candidate.first_name ?? candidate.name?.split(' ')[0] ?? 'daar';
  const role = signals.brief_role ?? 'een rol';
  const company = signals.recent_company ? ` bij ${signals.recent_company}` : '';
  const recruiter = signals.recruiter_name ?? 'het team';

  // If a template is provided, render its merge vars deterministically — this
  // gives recruiters predictable behaviour in mock mode.
  if (template?.body) {
    const ctx: MergeContext = {
      candidate: { first_name: firstName, name: candidate.name ?? '' },
      job: { title: role },
      recruiter: { name: recruiter },
      signals: signals as Record<string, unknown>,
    };
    return {
      subject: applyMergeVars(template.subject ?? `Snel even contact, ${firstName}`, ctx),
      body_text: applyMergeVars(template.body, ctx),
    };
  }

  if (channel === 'linkedin_connection') {
    return {
      subject: '',
      body_text: `Hoi ${firstName}, ik volg je werk${company} en zou je graag in mijn netwerk willen.`,
    };
  }
  if (channel === 'sms' || channel === 'whatsapp') {
    return {
      subject: '',
      body_text: `Hoi ${firstName}, ${recruiter} hier — heb een interessante ${role}-rol voor je. Mag ik je bellen?`,
    };
  }
  return {
    subject: `${firstName}, ben je open voor een ${role}?`,
    body_text:
      `Hoi ${firstName},\n\n` +
      `Ik zag je profiel${company} en wilde je graag persoonlijk benaderen voor een ${role}-rol bij ons.\n\n` +
      `Het is een team waar je echt impact kunt hebben — geen 'corporate' brei. Heb je 15 min om kort te kennismaken?\n\n` +
      `Groet,\n${recruiter}`,
  };
}

async function runDraft(
  candidate: { first_name?: string | null; name?: string | null; email?: string | null },
  signals: DraftSignals,
  channel: OutreachChannel,
  template?: { subject?: string | null; body?: string | null } | null
): Promise<MockOrAiResult> {
  if (shouldUseMock()) {
    const draft = buildMockDraft(candidate, signals, channel, template);
    return {
      subject: draft.subject,
      body_text: draft.body_text,
      modelUsed: `${PRIMARY_MODEL}-mock`,
      mocked: true,
    };
  }

  const client = await getAnthropicClient();
  const userPrompt = buildUserPrompt(candidate, signals, template);
  const response = await client.messages.create({
    model: PRIMARY_MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT_BASE,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock?.text) {
    throw new Error('outreach.ai: lege respons (geen text-block).');
  }
  const parsed = extractJson(textBlock.text) as { subject?: string; body_text?: string };
  if (typeof parsed.body_text !== 'string') {
    throw new Error('outreach.ai: response missing body_text');
  }
  return {
    subject: parsed.subject ?? '',
    body_text: parsed.body_text,
    promptTokens: response.usage?.input_tokens,
    completionTokens: response.usage?.output_tokens,
    modelUsed: PRIMARY_MODEL,
    mocked: false,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Public API — drafting + lifecycle
// ───────────────────────────────────────────────────────────────────────────

export interface DraftOptions {
  userId: string;
  auditCtx?: AuditContext;
  /** When false the message goes straight to `approved`, ready to send. */
  requireApproval?: boolean;
}

export async function draftOutreachMessage(
  tenantId: string,
  candidateId: string,
  stepConfig: DraftStepConfig,
  signals: DraftSignals,
  opts: DraftOptions
): Promise<DraftedMessage> {
  const startedAt = Date.now();

  return withTenant(tenantId, async (client) => {
    const { rows: [candidate] } = await client.query<{
      id: string;
      name: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }>(
      `SELECT id, name, first_name, last_name, email
         FROM candidates
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [candidateId, tenantId]
    );
    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    const draft = await runDraft(
      candidate,
      signals,
      stepConfig.channel,
      stepConfig.template_subject || stepConfig.template_body
        ? { subject: stepConfig.template_subject ?? null, body: stepConfig.template_body ?? null }
        : null
    );

    const requireApproval = opts.requireApproval ?? (stepConfig.ai_personalize !== false);
    const status: OutreachStatus = requireApproval ? 'pending_approval' : 'approved';

    const { rows: [inserted] } = await client.query<OutreachMessageRow>(
      `INSERT INTO outreach_messages
         (tenant_id, enrollment_id, step_id, candidate_id, channel, direction,
          status, subject, body_text, body_html,
          ai_model, prompt_tokens, completion_tokens,
          personalization_signals, metadata)
       VALUES ($1, $2, $3, $4, $5, 'outbound',
               $6, $7, $8, NULL,
               $9, $10, $11,
               $12::jsonb, '{}'::jsonb)
       RETURNING *`,
      [
        tenantId,
        stepConfig.enrollment_id ?? null,
        stepConfig.step_id ?? null,
        candidateId,
        stepConfig.channel,
        status,
        draft.subject || null,
        draft.body_text,
        draft.modelUsed,
        draft.promptTokens ?? null,
        draft.completionTokens ?? null,
        JSON.stringify(signals ?? {}),
      ]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'outreach.message.drafted',
        entityType: 'outreach_message',
        entityId: inserted.id,
        userId: opts.userId,
        after: { channel: stepConfig.channel, status, candidate_id: candidateId },
      },
      opts.auditCtx ?? {}
    );

    void logAIEvent(tenantId, {
      feature: 'outreach_draft',
      model: draft.modelUsed,
      provider: 'anthropic',
      input: JSON.stringify({ candidateId, signals, channel: stepConfig.channel }),
      inputTokens: draft.promptTokens,
      outputTokens: draft.completionTokens,
      outputSummary: (draft.subject || draft.body_text).slice(0, 200),
      latencyMs: Date.now() - startedAt,
      entityType: 'outreach_message',
      entityId: inserted.id,
      userId: opts.userId,
      status: draft.mocked ? 'mocked' : 'success',
    });

    return { message: inserted, mocked: draft.mocked };
  });
}

export async function regenerateMessage(
  tenantId: string,
  messageId: string,
  opts: DraftOptions
): Promise<DraftedMessage> {
  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query<OutreachMessageRow>(
      `SELECT * FROM outreach_messages
         WHERE id = $1 AND tenant_id = $2`,
      [messageId, tenantId]
    );
    if (!existing) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Bericht niet gevonden');
    if (existing.sent_at) {
      throw new AppError(409, 'MESSAGE_ALREADY_SENT', 'Bericht is al verstuurd — kan niet regenereren');
    }
    if (existing.direction !== 'outbound') {
      throw new AppError(400, 'INVALID_DIRECTION', 'Alleen outbound berichten kunnen geregenereerd worden');
    }

    const signals = (existing.personalization_signals ?? {}) as DraftSignals;
    return draftOutreachMessage(
      tenantId,
      existing.candidate_id,
      {
        channel: existing.channel,
        step_id: existing.step_id,
        enrollment_id: existing.enrollment_id,
      },
      signals,
      opts
    );
  });
}

export interface ApproveOptions {
  userId: string;
  auditCtx?: AuditContext;
}

export async function approveMessage(
  tenantId: string,
  messageId: string,
  opts: ApproveOptions
): Promise<OutreachMessageRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<OutreachMessageRow>(
      `UPDATE outreach_messages
          SET status = 'approved',
              approved_by = $1,
              approved_at = now()
        WHERE id = $2 AND tenant_id = $3
          AND status IN ('drafted','pending_approval')
        RETURNING *`,
      [opts.userId, messageId, tenantId]
    );
    if (!row) {
      const { rows: [check] } = await client.query<{ status: OutreachStatus }>(
        `SELECT status FROM outreach_messages WHERE id = $1 AND tenant_id = $2`,
        [messageId, tenantId]
      );
      if (!check) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Bericht niet gevonden');
      throw new AppError(
        409,
        'INVALID_STATUS',
        `Kan bericht in status '${check.status}' niet goedkeuren`
      );
    }
    await logAudit(
      client,
      tenantId,
      {
        action: 'outreach.message.approved',
        entityType: 'outreach_message',
        entityId: row.id,
        userId: opts.userId,
        after: { status: 'approved' },
      },
      opts.auditCtx ?? {}
    );
    return row;
  }).then(async (row) => {
    // Schedule channel-specific send job.
    await enqueueChannelSend(row);
    return row;
  });
}

async function enqueueChannelSend(row: OutreachMessageRow): Promise<void> {
  const payload = { tenantId: row.tenant_id, messageId: row.id };
  if (row.channel === 'linkedin_inmail' || row.channel === 'linkedin_connection') {
    await outreachLinkedInQueue.add('send-linkedin', payload);
  } else if (row.channel === 'email') {
    await outreachEmailNurtureQueue.add('send-email', payload);
  } else {
    // sms / whatsapp — not yet implemented as live workers; drop on linkedin
    // queue so we still have a path for tests. In production the dispatcher
    // would route to a Twilio/MessageBird worker.
    await outreachLinkedInQueue.add('send-other', payload);
  }
}

export interface RejectOptions {
  userId: string;
  reason: string;
  auditCtx?: AuditContext;
  /** When the rejected message belongs to an enrollment, also pause it. */
  pauseEnrollment?: boolean;
}

export async function rejectMessage(
  tenantId: string,
  messageId: string,
  opts: RejectOptions
): Promise<OutreachMessageRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<OutreachMessageRow>(
      `UPDATE outreach_messages
          SET status = 'rejected_by_recruiter',
              rejected_by = $1,
              rejected_at = now(),
              rejection_reason = $2
        WHERE id = $3 AND tenant_id = $4
          AND status IN ('drafted','pending_approval','approved')
        RETURNING *`,
      [opts.userId, opts.reason.slice(0, 1000), messageId, tenantId]
    );
    if (!row) {
      throw new AppError(409, 'INVALID_STATUS', 'Bericht kan niet meer afgewezen worden');
    }

    if (opts.pauseEnrollment && row.enrollment_id) {
      await client.query(
        `UPDATE nurture_enrollments
            SET status = 'paused', stopped_reason = $1
          WHERE id = $2 AND tenant_id = $3
            AND status IN ('active','pending_approval')`,
        ['recruiter rejected drafted message', row.enrollment_id, tenantId]
      );
    }

    await logAudit(
      client,
      tenantId,
      {
        action: 'outreach.message.rejected',
        entityType: 'outreach_message',
        entityId: row.id,
        userId: opts.userId,
        after: { status: 'rejected_by_recruiter', reason: opts.reason },
      },
      opts.auditCtx ?? {}
    );
    return row;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Quota enforcement — atomic SQL increment
// ───────────────────────────────────────────────────────────────────────────

export class QuotaExceededError extends AppError {
  constructor(limit: number, scope: 'daily' | 'weekly') {
    super(
      429,
      scope === 'daily' ? 'QUOTA_DAILY_EXCEEDED' : 'QUOTA_WEEKLY_EXCEEDED',
      scope === 'daily'
        ? `Daglimiet (${limit}) bereikt voor dit kanaal`
        : `Weeklimiet (${limit}) bereikt voor dit kanaal`
    );
  }
}

/**
 * Atomically reserve quota for a (recruiter, channel) tuple. Returns true on
 * success. On failure the caller must abort the send.
 *
 * The SQL uses an UPSERT followed by a conditional UPDATE: the UPDATE only
 * increments when both counters are below their limits AND the date columns
 * still match today — otherwise it resets the counters first.
 */
export async function reserveQuota(
  tenantId: string,
  recruiterId: string,
  channel: OutreachChannel
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    // 1) Ensure row exists with default limits.
    await client.query(
      `INSERT INTO outreach_quotas
         (tenant_id, recruiter_id, channel,
          daily_limit, weekly_limit,
          current_day_count, current_week_count,
          reset_day_at, reset_week_at)
       VALUES ($1, $2, $3, $4, $5, 0, 0, CURRENT_DATE, CURRENT_DATE)
       ON CONFLICT (tenant_id, recruiter_id, channel) DO NOTHING`,
      [tenantId, recruiterId, channel, DEFAULT_DAILY_LIMIT, DEFAULT_WEEKLY_LIMIT]
    );

    // 2) Reset counters if date rolled. ISOWEEK = first day of week.
    await client.query(
      `UPDATE outreach_quotas
         SET current_day_count  = CASE WHEN reset_day_at  = CURRENT_DATE THEN current_day_count  ELSE 0 END,
             reset_day_at       = CURRENT_DATE,
             current_week_count = CASE WHEN reset_week_at >= date_trunc('week', CURRENT_DATE)::date
                                       THEN current_week_count ELSE 0 END,
             reset_week_at      = date_trunc('week', CURRENT_DATE)::date
        WHERE tenant_id = $1 AND recruiter_id = $2 AND channel = $3`,
      [tenantId, recruiterId, channel]
    );

    // 3) Atomic conditional increment.
    const { rows } = await client.query<{
      current_day_count: number;
      current_week_count: number;
      daily_limit: number;
      weekly_limit: number;
    }>(
      `UPDATE outreach_quotas
          SET current_day_count  = current_day_count + 1,
              current_week_count = current_week_count + 1,
              updated_at         = now()
        WHERE tenant_id = $1 AND recruiter_id = $2 AND channel = $3
          AND current_day_count  < daily_limit
          AND current_week_count < weekly_limit
        RETURNING current_day_count, current_week_count, daily_limit, weekly_limit`,
      [tenantId, recruiterId, channel]
    );

    if (rows.length === 0) {
      const { rows: [snap] } = await client.query<{
        current_day_count: number;
        current_week_count: number;
        daily_limit: number;
        weekly_limit: number;
      }>(
        `SELECT current_day_count, current_week_count, daily_limit, weekly_limit
           FROM outreach_quotas
           WHERE tenant_id = $1 AND recruiter_id = $2 AND channel = $3`,
        [tenantId, recruiterId, channel]
      );
      if (snap && snap.current_week_count >= snap.weekly_limit) {
        throw new QuotaExceededError(snap.weekly_limit, 'weekly');
      }
      throw new QuotaExceededError(snap?.daily_limit ?? DEFAULT_DAILY_LIMIT, 'daily');
    }
  });
}

export async function listQuotas(tenantId: string): Promise<QuotaRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<QuotaRow>(
      `SELECT * FROM outreach_quotas
         WHERE tenant_id = $1
         ORDER BY recruiter_id, channel`,
      [tenantId]
    );
    return rows;
  });
}

export async function updateQuota(
  tenantId: string,
  recruiterId: string,
  channel: OutreachChannel,
  patch: { daily_limit?: number; weekly_limit?: number }
): Promise<QuotaRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<QuotaRow>(
      `INSERT INTO outreach_quotas
         (tenant_id, recruiter_id, channel,
          daily_limit, weekly_limit,
          reset_day_at, reset_week_at)
       VALUES ($1, $2, $3,
               COALESCE($4, $6), COALESCE($5, $7),
               CURRENT_DATE, CURRENT_DATE)
       ON CONFLICT (tenant_id, recruiter_id, channel) DO UPDATE
          SET daily_limit  = COALESCE(EXCLUDED.daily_limit,  outreach_quotas.daily_limit),
              weekly_limit = COALESCE(EXCLUDED.weekly_limit, outreach_quotas.weekly_limit),
              updated_at   = now()
       RETURNING *`,
      [
        tenantId,
        recruiterId,
        channel,
        patch.daily_limit ?? null,
        patch.weekly_limit ?? null,
        DEFAULT_DAILY_LIMIT,
        DEFAULT_WEEKLY_LIMIT,
      ]
    );
    return row;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Sending — invoked by channel workers
// ───────────────────────────────────────────────────────────────────────────

export interface SendResult {
  status: OutreachStatus;
  external_id: string | null;
  external_thread_id: string | null;
}

/**
 * Mark a message as `sending` then `sent` (or `failed`). Quota check happens
 * before the actual send. Used by `outreachLinkedIn.worker.ts` and
 * `outreachEmailNurture.worker.ts`. The `attemptSend` callback is provided
 * by the worker — we keep the channel-specific call out of this service.
 */
export async function sendMessage(
  tenantId: string,
  messageId: string,
  attemptSend: (msg: OutreachMessageRow) => Promise<{
    external_id: string;
    external_thread_id?: string;
  }>
): Promise<SendResult> {
  // Step 1: load message + claim quota
  const message = await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<OutreachMessageRow>(
      `SELECT * FROM outreach_messages
         WHERE id = $1 AND tenant_id = $2`,
      [messageId, tenantId]
    );
    if (!row) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Bericht niet gevonden');
    if (row.status !== 'approved' && row.status !== 'sending') {
      throw new AppError(409, 'INVALID_STATUS', `Kan niet versturen in status '${row.status}'`);
    }
    return row;
  });

  // Reserve quota against the recruiter that approved (fall back to recruiter
  // tied to the enrollment if no approver — e.g. auto-approved short messages).
  const recruiterId =
    message.approved_by ??
    ((message.metadata as Record<string, unknown>)?.scheduled_by as string | undefined) ??
    null;
  if (recruiterId) {
    await reserveQuota(tenantId, recruiterId, message.channel);
  }

  // Step 2: flip to `sending` (separate tx so retries see the lock state)
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE outreach_messages
         SET status = 'sending'
         WHERE id = $1 AND tenant_id = $2 AND status = 'approved'`,
      [messageId, tenantId]
    );
  });

  // Step 3: invoke the worker callback.
  try {
    const sendOutcome = await attemptSend(message);
    return await withTenant(tenantId, async (client) => {
      const { rows: [updated] } = await client.query<OutreachMessageRow>(
        `UPDATE outreach_messages
            SET status = 'sent',
                external_id = $1,
                external_thread_id = $2,
                sent_at = now()
          WHERE id = $3 AND tenant_id = $4
          RETURNING *`,
        [sendOutcome.external_id, sendOutcome.external_thread_id ?? null, messageId, tenantId]
      );
      eventBus.emit('outreachMessageSent', {
        tenantId,
        messageId,
        candidateId: updated.candidate_id,
        channel: updated.channel,
        externalId: updated.external_id,
      });
      return {
        status: updated.status,
        external_id: updated.external_id,
        external_thread_id: updated.external_thread_id,
      };
    });
  } catch (err) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE outreach_messages
            SET status = 'failed',
                error_message = $1,
                retry_count = retry_count + 1
          WHERE id = $2 AND tenant_id = $3`,
        [(err as Error).message.slice(0, 500), messageId, tenantId]
      );
    });
    throw err;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Inbound replies
// ───────────────────────────────────────────────────────────────────────────

export interface ReplyInput {
  parentMessageId?: string | null;
  externalThreadId?: string | null;
  candidateId?: string | null;
  channel?: OutreachChannel;
  body_text: string;
  external_id?: string | null;
  received_at?: string | null;
}

export async function recordReply(
  tenantId: string,
  input: ReplyInput
): Promise<OutreachMessageRow> {
  return withTenant(tenantId, async (client) => {
    let parent: OutreachMessageRow | null = null;

    if (input.parentMessageId) {
      const { rows: [row] } = await client.query<OutreachMessageRow>(
        `SELECT * FROM outreach_messages WHERE id = $1 AND tenant_id = $2`,
        [input.parentMessageId, tenantId]
      );
      parent = row ?? null;
    }
    if (!parent && input.externalThreadId) {
      const { rows: [row] } = await client.query<OutreachMessageRow>(
        `SELECT * FROM outreach_messages
           WHERE tenant_id = $1 AND external_thread_id = $2 AND direction = 'outbound'
           ORDER BY sent_at DESC NULLS LAST, created_at DESC
           LIMIT 1`,
        [tenantId, input.externalThreadId]
      );
      parent = row ?? null;
    }

    const candidateId = parent?.candidate_id ?? input.candidateId;
    if (!candidateId) {
      throw new AppError(400, 'CANNOT_LINK_REPLY', 'Reply kan niet aan kandidaat gekoppeld worden');
    }

    const channel = parent?.channel ?? input.channel ?? 'email';
    const enrollmentId = parent?.enrollment_id ?? null;

    const { rows: [reply] } = await client.query<OutreachMessageRow>(
      `INSERT INTO outreach_messages
         (tenant_id, enrollment_id, step_id, candidate_id, channel, direction,
          status, body_text, external_id, external_thread_id, sent_at, metadata)
       VALUES ($1, $2, NULL, $3, $4, 'inbound',
               'sent', $5, $6, $7, COALESCE($8::timestamptz, now()), '{}'::jsonb)
       RETURNING *`,
      [
        tenantId,
        enrollmentId,
        candidateId,
        channel,
        input.body_text,
        input.external_id ?? null,
        input.externalThreadId ?? parent?.external_thread_id ?? null,
        input.received_at ?? null,
      ]
    );

    if (parent) {
      // append-only trigger forbids changing sent_at; reply_message_id is allowed.
      await client.query(
        `UPDATE outreach_messages
            SET reply_message_id = $1
          WHERE id = $2 AND tenant_id = $3 AND reply_message_id IS NULL`,
        [reply.id, parent.id, tenantId]
      );
    }

    if (enrollmentId) {
      await client.query(
        `UPDATE nurture_enrollments
            SET status = 'replied', stopped_reason = 'reply received'
          WHERE id = $1 AND tenant_id = $2 AND status IN ('active','pending_approval','paused')`,
        [enrollmentId, tenantId]
      );
    }

    eventBus.emit('replyReceived', {
      tenantId,
      messageId: reply.id,
      candidateId,
      parentMessageId: parent?.id ?? '',
    });

    // Trigger classification asynchronously.
    await replyClassificationQueue.add('classify-reply', {
      tenantId,
      messageId: reply.id,
    });

    return reply;
  });
}

export async function markAsRepliedHandlesEnrollment(
  tenantId: string,
  enrollmentId: string
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE nurture_enrollments
          SET status = 'replied', stopped_reason = 'reply detected'
        WHERE id = $1 AND tenant_id = $2 AND status NOT IN ('replied','stopped','completed')`,
      [enrollmentId, tenantId]
    );
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Listing — used by routes
// ───────────────────────────────────────────────────────────────────────────

export interface ListMessagesFilters {
  status?: OutreachStatus;
  candidate_id?: string;
  direction?: OutreachDirection;
  cursor?: string;
  limit?: number;
}

export async function listMessages(
  tenantId: string,
  filters: ListMessagesFilters
): Promise<{ data: OutreachMessageRow[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [`tenant_id = $1`];
    const values: unknown[] = [tenantId];
    if (filters.status) {
      conds.push(`status = $${values.length + 1}`);
      values.push(filters.status);
    }
    if (filters.candidate_id) {
      conds.push(`candidate_id = $${values.length + 1}`);
      values.push(filters.candidate_id);
    }
    if (filters.direction) {
      conds.push(`direction = $${values.length + 1}`);
      values.push(filters.direction);
    }
    if (filters.cursor) {
      conds.push(`created_at < $${values.length + 1}`);
      values.push(filters.cursor);
    }
    const sql =
      `SELECT * FROM outreach_messages WHERE ${conds.join(' AND ')}` +
      ` ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`;
    const { rows } = await client.query<OutreachMessageRow>(sql, values);
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const next_cursor = hasMore ? data[data.length - 1].created_at : null;
    return { data, next_cursor };
  });
}

export async function getMessage(
  tenantId: string,
  messageId: string
): Promise<OutreachMessageRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<OutreachMessageRow>(
      `SELECT * FROM outreach_messages WHERE id = $1 AND tenant_id = $2`,
      [messageId, tenantId]
    );
    if (!row) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Bericht niet gevonden');
    return row;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Hook into Agent WWW's findingApproved event
// ───────────────────────────────────────────────────────────────────────────

let subscribed = false;

/**
 * Subscribe once at module load. Idempotent — calling twice is a no-op.
 * Reads `tenant_settings.default_sourcing_sequence_id` and (if set) enrolls
 * the candidate via `nurture.service.enrollCandidate`. Failures are logged
 * but never crash the emitter — this is best-effort orchestration.
 */
export function subscribeToSourcingEvents(): void {
  if (subscribed) return;
  subscribed = true;

  eventBus.on('findingApproved', async (payload: FindingApprovedPayload) => {
    try {
      const sequenceId = await loadDefaultSourcingSequenceId(payload.tenantId);
      if (!sequenceId) {
        logger.info('[outreach] findingApproved: no default sequence — skipping auto-enroll', {
          tenantId: payload.tenantId,
          findingId: payload.findingId,
        });
        return;
      }
      const { enrollCandidate } = await import('../nurture/nurture.service');
      await enrollCandidate(payload.tenantId, {
        candidateId: payload.candidateId,
        sequenceId,
        findingId: payload.findingId,
        requireApproval: true,
        userId: payload.approvedBy ?? null,
      });
      logger.info('[outreach] auto-enrolled candidate from findingApproved', {
        tenantId: payload.tenantId,
        candidateId: payload.candidateId,
        sequenceId,
      });
    } catch (err) {
      logger.warn('[outreach] auto-enroll on findingApproved failed', {
        error: (err as Error).message,
        payload,
      });
    }
  });
}

async function loadDefaultSourcingSequenceId(tenantId: string): Promise<string | null> {
  // tenant_settings is shared infra. We use withoutTenant to avoid a chicken-
  // and-egg if RLS isn't yet set up for that table.
  return withoutTenant(async (client) => {
    try {
      const { rows } = await client.query<{ value: string | null }>(
        `SELECT value FROM tenant_settings
           WHERE tenant_id = $1 AND key = 'default_sourcing_sequence_id'
           LIMIT 1`,
        [tenantId]
      );
      const v = rows[0]?.value;
      return typeof v === 'string' && v.length > 0 ? v : null;
    } catch {
      // tenant_settings may not exist — graceful no-op.
      return null;
    }
  });
}

// Auto-subscribe on import. Safe — listener is idempotent + isolates errors.
subscribeToSourcingEvents();

// Re-export for tests.
export const __test = {
  buildMockDraft,
  shouldUseMock,
};

/**
 * OpenAPI route specs for `/api/outreach/*` — Sprint Q4.5 (Agent XXX).
 *
 * Tag: `Outreach`. Pragmatic schemas — `z.unknown()` for nested-heavy fields
 * keeps the spec compact. Companion: `nurture.ts`.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

const channelEnum = z.enum([
  'linkedin_inmail',
  'linkedin_connection',
  'email',
  'sms',
  'whatsapp',
]);
const directionEnum = z.enum(['outbound', 'inbound']);
const statusEnum = z.enum([
  'drafted',
  'pending_approval',
  'approved',
  'sending',
  'sent',
  'failed',
  'rejected_by_recruiter',
]);

const OutreachMessage = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    enrollment_id: z.string().uuid().nullable(),
    step_id: z.string().uuid().nullable(),
    candidate_id: z.string().uuid(),
    channel: channelEnum,
    direction: directionEnum,
    status: statusEnum,
    subject: z.string().nullable(),
    body_text: z.string().nullable(),
    body_html: z.string().nullable(),
    ai_model: z.string().nullable(),
    prompt_tokens: z.number().nullable(),
    completion_tokens: z.number().nullable(),
    personalization_signals: z.record(z.unknown()),
    scheduled_for: z.string().datetime().nullable(),
    sent_at: z.string().datetime().nullable(),
    external_id: z.string().nullable(),
    external_thread_id: z.string().nullable(),
    approved_by: z.string().uuid().nullable(),
    approved_at: z.string().datetime().nullable(),
    rejected_by: z.string().uuid().nullable(),
    rejected_at: z.string().datetime().nullable(),
    rejection_reason: z.string().nullable(),
    reply_message_id: z.string().uuid().nullable(),
    error_message: z.string().nullable(),
    retry_count: z.number(),
    metadata: z.record(z.unknown()),
    created_at: z.string().datetime(),
  })
  .openapi('OutreachMessage');

const Quota = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    recruiter_id: z.string().uuid(),
    channel: channelEnum,
    daily_limit: z.number(),
    weekly_limit: z.number(),
    current_day_count: z.number(),
    current_week_count: z.number(),
    reset_day_at: z.string().nullable(),
    reset_week_at: z.string().nullable(),
  })
  .openapi('OutreachQuota');

const ReplyClassification = z
  .object({
    id: z.string().uuid(),
    message_id: z.string().uuid(),
    category: z.enum([
      'interested',
      'not_now',
      'not_interested',
      'out_of_office',
      'unsubscribe',
      'spam',
      'question',
      'unknown',
    ]),
    sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']),
    next_action: z.enum([
      'schedule_call',
      'send_followup',
      'pause_sequence',
      'remove_from_outreach',
      'manual_review',
    ]),
    reasoning: z.string().nullable(),
    confidence: z.number().nullable(),
    ai_model: z.string().nullable(),
    classified_at: z.string().datetime(),
  })
  .openapi('ReplyClassification');

const CandidateSignal = z
  .object({
    id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    signal_type: z.enum([
      'job_change',
      'title_change',
      'company_growth',
      'funding_round',
      'linkedin_post',
      'open_to_work_flag',
    ]),
    detected_at: z.string().datetime(),
    source: z.string().nullable(),
    before_value: z.string().nullable(),
    after_value: z.string().nullable(),
    raw_payload: z.record(z.unknown()),
    reviewed: z.boolean(),
    reviewed_by: z.string().uuid().nullable(),
    reviewed_at: z.string().datetime().nullable(),
    triggered_action: z.string().nullable(),
  })
  .openapi('CandidateSignal');

const DraftBody = z
  .object({
    candidate_id: z.string().uuid(),
    channel: channelEnum,
    step_id: z.string().uuid().nullable().optional(),
    enrollment_id: z.string().uuid().nullable().optional(),
    signals: z.record(z.unknown()).optional(),
    template_subject: z.string().nullable().optional(),
    template_body: z.string().nullable().optional(),
    ai_personalize: z.boolean().optional(),
    require_approval: z.boolean().optional(),
  })
  .openapi('OutreachDraftBody');

const RejectBody = z
  .object({
    reason: z.string(),
    pause_enrollment: z.boolean().optional(),
  })
  .openapi('OutreachRejectBody');

const QuotaPatchBody = z
  .object({
    daily_limit: z.number().int().min(0).optional(),
    weekly_limit: z.number().int().min(0).optional(),
  })
  .openapi('OutreachQuotaPatchBody');

const DraftReactivationBody = z
  .object({ sequence_id: z.string().uuid() })
  .openapi('SignalDraftReactivationBody');

// ───── Paths ──────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/outreach/messages',
  tags: ['Outreach'],
  summary: 'List outreach messages (cursor-paginated)',
  security: authSecurity,
  request: {
    query: z.object({
      status: statusEnum.optional(),
      candidate_id: z.string().uuid().optional(),
      direction: directionEnum.optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(OutreachMessage),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/outreach/messages/{id}',
  tags: ['Outreach'],
  summary: 'Get a single outreach message',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse('OK', z.object({ data: OutreachMessage })),
    404: { description: 'Niet gevonden' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/outreach/messages/draft',
  tags: ['Outreach'],
  summary: 'Draft a new AI-personalized outreach message',
  security: authSecurity,
  request: { body: { content: { 'application/json': { schema: DraftBody } } } },
  responses: {
    201: jsonResponse(
      'Aangemaakt',
      z.object({ data: OutreachMessage, mocked: z.boolean() })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/outreach/messages/{id}/approve',
  tags: ['Outreach'],
  summary: 'Approve a drafted message and queue it for sending',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse('OK', z.object({ data: OutreachMessage })),
    409: { description: 'Status laat goedkeuren niet meer toe' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/outreach/messages/{id}/reject',
  tags: ['Outreach'],
  summary: 'Reject a drafted message (optional: pause the enrollment)',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: RejectBody } } },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: OutreachMessage })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/outreach/messages/{id}/regenerate',
  tags: ['Outreach'],
  summary: 'Regenerate the body of a drafted message via AI',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({ data: OutreachMessage, mocked: z.boolean() })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/outreach/quotas',
  tags: ['Outreach'],
  summary: 'List per-recruiter / per-channel send quotas',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(Quota) })),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/outreach/quotas/{recruiterId}/{channel}',
  tags: ['Outreach'],
  summary: 'Update daily / weekly quota limits',
  security: authSecurity,
  request: {
    params: z.object({
      recruiterId: z.string().uuid(),
      channel: channelEnum,
    }),
    body: { content: { 'application/json': { schema: QuotaPatchBody } } },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: Quota })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/outreach/replies',
  tags: ['Outreach'],
  summary: 'List inbound reply classifications',
  security: authSecurity,
  request: {
    query: z.object({
      category: z
        .enum([
          'interested',
          'not_now',
          'not_interested',
          'out_of_office',
          'unsubscribe',
          'spam',
          'question',
          'unknown',
        ])
        .optional(),
      unreviewed: z.coerce.boolean().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(ReplyClassification),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/outreach/signals',
  tags: ['Outreach'],
  summary: 'List passive monitoring signals (job-change, etc.)',
  security: authSecurity,
  request: {
    query: z.object({
      signal_type: z
        .enum([
          'job_change',
          'title_change',
          'company_growth',
          'funding_round',
          'linkedin_post',
          'open_to_work_flag',
        ])
        .optional(),
      unreviewed: z.coerce.boolean().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(CandidateSignal),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/outreach/signals/{id}/dismiss',
  tags: ['Outreach'],
  summary: 'Mark a signal as reviewed (no further action)',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse('OK', z.object({ data: CandidateSignal })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/outreach/signals/{id}/draft-reactivation',
  tags: ['Outreach'],
  summary: 'Enroll the candidate in a reactivation sequence',
  security: authSecurity,
  request: {
    params: idParam,
    body: {
      content: { 'application/json': { schema: DraftReactivationBody } },
    },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: z.unknown() })),
  },
});

// Public reply webhook
registry.registerPath({
  method: 'post',
  path: '/api/webhooks/outreach/replies',
  tags: ['Outreach'],
  summary: 'HMAC-signed reply webhook from outreach vendor',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              tenant_id: z.string().uuid(),
              channel: channelEnum,
              external_thread_id: z.string(),
              candidate_external_id: z.string().optional(),
              reply_text: z.string(),
              sent_at: z.string().datetime().optional(),
            })
            .openapi('OutreachReplyWebhookBody'),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      'Recorded',
      z.object({
        data: z.object({ id: z.string().uuid(), status: z.literal('recorded') }),
      })
    ),
    401: { description: 'Invalid signature' },
  },
});

/**
 * Webhooks route-specs — `/api/webhooks/*` + event payload-schemas.
 *
 * Documenteert alle event-types waarvoor een tenant kan abonneren. Sluit
 * aan op `apps/api/src/lib/auditActions.ts`.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

// ─── Webhook resource ──────────────────────────────────────────────────────

const Webhook = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    name: z.string(),
    url: z.string().url(),
    events: z.array(z.string()),
    active: z.boolean(),
    secret: z.string().openapi({
      description:
        'HMAC-SHA256 secret. Gebruik om de `X-TalentFlow-Signature`-header te valideren bij elke delivery.',
    }),
    created_at: z.string().datetime(),
  })
  .openapi('Webhook');

const WebhookLog = z
  .object({
    id: z.string().uuid(),
    webhook_id: z.string().uuid(),
    event: z.string(),
    status: z.enum(['success', 'failed']),
    response_code: z.number().int().nullable(),
    duration_ms: z.number().int().nullable(),
    delivered_at: z.string().datetime(),
    error: z.string().nullable(),
  })
  .openapi('WebhookLog');

// ─── Event payloads ────────────────────────────────────────────────────────
// Iedere webhook-payload volgt het format `{ event, occurred_at, tenant_id, data }`.

const WebhookEnvelope = <T extends z.ZodTypeAny>(eventName: string, data: T) =>
  z.object({
    event: z.literal(eventName),
    occurred_at: z.string().datetime(),
    tenant_id: z.string().uuid(),
    data,
  });

const CandidateCreatedPayload = WebhookEnvelope(
  'candidate.created',
  z.object({
    candidate_id: z.string().uuid(),
    name: z.string(),
    email: z.string().email().nullable(),
    source: z.string().nullable(),
  })
).openapi('CandidateCreatedPayload');

const CandidateUpdatedPayload = WebhookEnvelope(
  'candidate.updated',
  z.object({
    candidate_id: z.string().uuid(),
    changes: z.record(z.unknown()),
  })
).openapi('CandidateUpdatedPayload');

const ApplicationStageChangedPayload = WebhookEnvelope(
  'application.stage_changed',
  z.object({
    application_id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    job_id: z.string().uuid(),
    from_stage_id: z.string().uuid().nullable(),
    to_stage_id: z.string().uuid(),
    moved_by_user_id: z.string().uuid().nullable(),
  })
).openapi('ApplicationStageChangedPayload');

const ApplicationHiredPayload = WebhookEnvelope(
  'application.hired',
  z.object({
    application_id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    job_id: z.string().uuid(),
    hired_at: z.string().datetime(),
  })
).openapi('ApplicationHiredPayload');

const ApplicationRejectedPayload = WebhookEnvelope(
  'application.rejected',
  z.object({
    application_id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    job_id: z.string().uuid(),
    rejected_at: z.string().datetime(),
    reason: z.string().nullable(),
  })
).openapi('ApplicationRejectedPayload');

const JobCreatedPayload = WebhookEnvelope(
  'job.created',
  z.object({
    job_id: z.string().uuid(),
    title: z.string(),
    status: z.string(),
  })
).openapi('JobCreatedPayload');

const JobFilledPayload = WebhookEnvelope(
  'job.filled',
  z.object({ job_id: z.string().uuid(), filled_at: z.string().datetime() })
).openapi('JobFilledPayload');

const InterviewScheduledPayload = WebhookEnvelope(
  'interview.scheduled',
  z.object({
    interview_id: z.string().uuid(),
    application_id: z.string().uuid(),
    starts_at: z.string().datetime(),
    interviewers: z.array(z.string().uuid()),
  })
).openapi('InterviewScheduledPayload');

// Register schemas zodat ze in de spec referenced kunnen worden.
registry.register('CandidateCreatedPayload', CandidateCreatedPayload);
registry.register('CandidateUpdatedPayload', CandidateUpdatedPayload);
registry.register('ApplicationStageChangedPayload', ApplicationStageChangedPayload);
registry.register('ApplicationHiredPayload', ApplicationHiredPayload);
registry.register('ApplicationRejectedPayload', ApplicationRejectedPayload);
registry.register('JobCreatedPayload', JobCreatedPayload);
registry.register('JobFilledPayload', JobFilledPayload);
registry.register('InterviewScheduledPayload', InterviewScheduledPayload);

// ─── Lijst van ondersteunde events ─────────────────────────────────────────
// Spiegelt apps/api/src/lib/auditActions.ts. Niet alle audit-events zijn ook
// webhook-events; we exposen de events die voor third-party integraties zinvol
// zijn (geen GDPR-internals, geen training-events).

const SUPPORTED_WEBHOOK_EVENTS = [
  // Candidates
  'candidate.created',
  'candidate.updated',
  'candidate.deleted',
  'candidate.resume_uploaded',
  'candidate.skill_added',
  'candidate.merged',
  // Jobs
  'job.created',
  'job.updated',
  'job.filled',
  'job.duplicated',
  // Applications
  'application.created',
  'application.stage_changed',
  'application.rejected',
  'application.hired',
  // Interviews
  'interview.scheduled',
  'interview.rescheduled',
  'interview.cancelled',
  // Communications
  'bulk_campaign.completed',
  // Reports
  'report.scheduled_run',
] as const;

// ─── Routes ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/webhooks',
  tags: ['Webhooks'],
  summary: 'List webhook subscriptions',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(Webhook)) },
});

registry.registerPath({
  method: 'post',
  path: '/api/webhooks',
  tags: ['Webhooks'],
  summary: 'Create webhook subscription',
  description: [
    'TalentFlow signeert iedere delivery met HMAC-SHA256:',
    '`X-TalentFlow-Signature: sha256=<hex>` (HMAC over raw body, key = `secret`).',
    'Retry-policy: 5 pogingen met exponential backoff (1s, 5s, 30s, 5min, 30min).',
    'Failed deliveries verschijnen in `/api/webhooks/{id}/logs`.',
    '',
    `**Ondersteunde events**: ${SUPPORTED_WEBHOOK_EVENTS.join(', ')}.`,
  ].join('\n'),
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(200),
            url: z.string().url(),
            events: z.array(z.enum(SUPPORTED_WEBHOOK_EVENTS)).min(1),
          }),
        },
      },
    },
  },
  responses: { 201: jsonResponse('Aangemaakt', Webhook) },
});

registry.registerPath({
  method: 'patch',
  path: '/api/webhooks/{id}',
  tags: ['Webhooks'],
  summary: 'Update webhook',
  security: authSecurity,
  request: {
    params: idParam,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              name: z.string().optional(),
              url: z.string().url().optional(),
              events: z.array(z.string()).min(1).optional(),
              active: z.boolean().optional(),
            })
            .partial(),
        },
      },
    },
  },
  responses: { 200: jsonResponse('OK', Webhook) },
});

registry.registerPath({
  method: 'patch',
  path: '/api/webhooks/{id}/toggle',
  tags: ['Webhooks'],
  summary: 'Toggle active state',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', Webhook) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/webhooks/{id}',
  tags: ['Webhooks'],
  summary: 'Delete webhook',
  security: authSecurity,
  request: { params: idParam },
  responses: { 204: { description: 'Verwijderd' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/webhooks/{id}/logs',
  tags: ['Webhooks'],
  summary: 'Webhook delivery logs',
  description: 'Laatste 100 deliveries inclusief response-code en eventueel error-message.',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.array(WebhookLog)) },
});

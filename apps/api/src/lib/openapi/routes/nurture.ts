/**
 * OpenAPI route specs for `/api/nurture/*` — Sprint Q4.5 (Agent XXX).
 *
 * Tag: `Nurture`. Companion to `outreach.ts`.
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
const enrollmentStatusEnum = z.enum([
  'pending_approval',
  'active',
  'paused',
  'stopped',
  'completed',
  'replied',
]);

const Sequence = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    active: z.boolean(),
    total_steps: z.number(),
    metadata: z.record(z.unknown()),
    created_by: z.string().uuid().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('NurtureSequence');

const Step = z
  .object({
    id: z.string().uuid(),
    sequence_id: z.string().uuid(),
    step_order: z.number(),
    channel: channelEnum,
    delay_days: z.number(),
    ai_personalize: z.boolean(),
    template_subject: z.string().nullable(),
    template_body: z.string().nullable(),
    stop_on_reply: z.boolean(),
    metadata: z.record(z.unknown()),
    created_at: z.string().datetime(),
  })
  .openapi('NurtureStep');

const Enrollment = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    finding_id: z.string().uuid().nullable(),
    sequence_id: z.string().uuid(),
    status: enrollmentStatusEnum,
    current_step_order: z.number(),
    next_send_at: z.string().datetime().nullable(),
    enrolled_by: z.string().uuid().nullable(),
    enrolled_at: z.string().datetime(),
    stopped_at: z.string().datetime().nullable(),
    stopped_reason: z.string().nullable(),
    metadata: z.record(z.unknown()),
  })
  .openapi('NurtureEnrollment');

const CreateSequenceBody = z
  .object({
    name: z.string(),
    description: z.string().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .openapi('CreateNurtureSequenceBody');

const AddStepBody = z
  .object({
    channel: channelEnum,
    delay_days: z.number().int(),
    ai_personalize: z.boolean().optional(),
    template_subject: z.string().nullable().optional(),
    template_body: z.string().nullable().optional(),
    stop_on_reply: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .openapi('AddNurtureStepBody');

const ReorderBody = z
  .object({ ordered_ids: z.array(z.string().uuid()) })
  .openapi('ReorderStepsBody');

const EnrollBody = z
  .object({
    candidate_id: z.string().uuid(),
    sequence_id: z.string().uuid(),
    finding_id: z.string().uuid().nullable().optional(),
    require_approval: z.boolean().optional(),
    signals: z.record(z.unknown()).optional(),
  })
  .openapi('EnrollCandidateBody');

const StopEnrollmentBody = z
  .object({ reason: z.string() })
  .openapi('StopEnrollmentBody');

// ───── Paths ─────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/nurture/sequences',
  tags: ['Nurture'],
  summary: 'List nurture sequences',
  security: authSecurity,
  request: {
    query: z.object({
      active: z.coerce.boolean().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(Sequence),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/nurture/sequences',
  tags: ['Nurture'],
  summary: 'Create a new sequence',
  security: authSecurity,
  request: {
    body: { content: { 'application/json': { schema: CreateSequenceBody } } },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: Sequence })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/nurture/sequences/{id}',
  tags: ['Nurture'],
  summary: 'Get a sequence including its ordered steps',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({ data: Sequence.extend({ steps: z.array(Step) }) })
    ),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/nurture/sequences/{id}',
  tags: ['Nurture'],
  summary: 'Update a sequence',
  security: authSecurity,
  request: {
    params: idParam,
    body: {
      content: {
        'application/json': { schema: CreateSequenceBody.partial() },
      },
    },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: Sequence })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/nurture/sequences/{id}/archive',
  tags: ['Nurture'],
  summary: 'Archive (deactivate) a sequence',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse('OK', z.object({ data: Sequence })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/nurture/sequences/{id}/steps',
  tags: ['Nurture'],
  summary: 'Append a step to a sequence',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: AddStepBody } } },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: Step })),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/nurture/sequences/{id}/steps/{stepId}',
  tags: ['Nurture'],
  summary: 'Patch a step',
  security: authSecurity,
  request: {
    params: z.object({
      id: z.string().uuid(),
      stepId: z.string().uuid(),
    }),
    body: {
      content: { 'application/json': { schema: AddStepBody.partial() } },
    },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: Step })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/nurture/sequences/{id}/steps/reorder',
  tags: ['Nurture'],
  summary: 'Reorder steps within a sequence',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: ReorderBody } } },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(Step) })),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/nurture/sequences/{id}/steps/{stepId}',
  tags: ['Nurture'],
  summary: 'Remove a step (re-sequences remaining)',
  security: authSecurity,
  request: {
    params: z.object({
      id: z.string().uuid(),
      stepId: z.string().uuid(),
    }),
  },
  responses: { 204: { description: 'Verwijderd' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/nurture/enrollments',
  tags: ['Nurture'],
  summary: 'List enrollments',
  security: authSecurity,
  request: {
    query: z.object({
      candidate_id: z.string().uuid().optional(),
      sequence_id: z.string().uuid().optional(),
      status: enrollmentStatusEnum.optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(Enrollment),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/nurture/enrollments',
  tags: ['Nurture'],
  summary: 'Enroll a candidate in a sequence',
  security: authSecurity,
  request: {
    body: { content: { 'application/json': { schema: EnrollBody } } },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: Enrollment })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/nurture/enrollments/{id}',
  tags: ['Nurture'],
  summary: 'Get an enrollment',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse('OK', z.object({ data: Enrollment })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/nurture/enrollments/{id}/pause',
  tags: ['Nurture'],
  summary: 'Pause an active enrollment',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: Enrollment })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/nurture/enrollments/{id}/resume',
  tags: ['Nurture'],
  summary: 'Resume a paused enrollment',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: Enrollment })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/nurture/enrollments/{id}/stop',
  tags: ['Nurture'],
  summary: 'Stop an enrollment with a reason',
  security: authSecurity,
  request: {
    params: idParam,
    body: {
      content: { 'application/json': { schema: StopEnrollmentBody } },
    },
  },
  responses: { 200: jsonResponse('OK', z.object({ data: Enrollment })) },
});

/**
 * Interviews route-specs — `/api/interviews/*` + `/api/interview-kits/*`.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

const Interview = z
  .object({
    id: z.string().uuid(),
    application_id: z.string().uuid(),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime(),
    location: z.string().nullable(),
    meeting_url: z.string().url().nullable(),
    interviewer_user_ids: z.array(z.string().uuid()),
    status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']),
    kit_id: z.string().uuid().nullable(),
    notes: z.string().nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('Interview');

const InterviewKit = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    questions: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        category: z.string().nullable(),
        evaluation_criteria: z.string().nullable(),
      })
    ),
    created_at: z.string().datetime(),
  })
  .openapi('InterviewKit');

registry.registerPath({
  method: 'get',
  path: '/api/interviews',
  tags: ['Interviews'],
  summary: 'List interviews',
  security: authSecurity,
  request: {
    query: z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      application_id: z.string().uuid().optional(),
    }),
  },
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(Interview) })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/interviews',
  tags: ['Interviews'],
  summary: 'Schedule interview',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            application_id: z.string().uuid(),
            starts_at: z.string().datetime(),
            ends_at: z.string().datetime(),
            interviewer_user_ids: z.array(z.string().uuid()).min(1),
            location: z.string().optional(),
            meeting_url: z.string().url().optional(),
            kit_id: z.string().uuid().optional(),
          }),
        },
      },
    },
  },
  responses: { 201: jsonResponse('Aangemaakt', Interview) },
});

registry.registerPath({
  method: 'get',
  path: '/api/interviews/{id}',
  tags: ['Interviews'],
  summary: 'Get interview',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', Interview) },
});

registry.registerPath({
  method: 'patch',
  path: '/api/interviews/{id}',
  tags: ['Interviews'],
  summary: 'Update / reschedule interview',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', Interview) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/interviews/{id}',
  tags: ['Interviews'],
  summary: 'Cancel interview',
  security: authSecurity,
  request: { params: idParam },
  responses: { 204: { description: 'Cancelled' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/interviews/availability/slots',
  tags: ['Interviews'],
  summary: 'Find available slots',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            user_ids: z.array(z.string().uuid()).min(1),
            duration_minutes: z.number().int().min(15).max(240),
            from: z.string().datetime(),
            to: z.string().datetime(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        slots: z.array(z.object({ start: z.string().datetime(), end: z.string().datetime() })),
      })
    ),
  },
});

// ─── Interview kits ────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/interview-kits',
  tags: ['Interviews'],
  summary: 'List interview kits',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(InterviewKit)) },
});

registry.registerPath({
  method: 'post',
  path: '/api/interview-kits',
  tags: ['Interviews'],
  summary: 'Create interview kit',
  security: authSecurity,
  responses: { 201: jsonResponse('Aangemaakt', InterviewKit) },
});

registry.registerPath({
  method: 'get',
  path: '/api/interview-kits/{id}',
  tags: ['Interviews'],
  summary: 'Get interview kit',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', InterviewKit) },
});

registry.registerPath({
  method: 'patch',
  path: '/api/interview-kits/{id}',
  tags: ['Interviews'],
  summary: 'Update interview kit',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', InterviewKit) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/interview-kits/{id}',
  tags: ['Interviews'],
  summary: 'Delete interview kit',
  security: authSecurity,
  request: { params: idParam },
  responses: { 204: { description: 'Verwijderd' } },
});

// ─── Recordings ────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/interviews/{id}/recordings',
  tags: ['Interviews'],
  summary: 'Upload interview recording (audio/video)',
  description: 'Async transcription + AI summary via worker.',
  security: authSecurity,
  request: {
    params: idParam,
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({ file: z.string().openapi({ format: 'binary' }) }),
        },
      },
    },
  },
  responses: { 202: jsonResponse('In wachtrij', z.object({ recording_id: z.string().uuid() })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/interviews/{id}/recordings',
  tags: ['Interviews'],
  summary: 'List recordings for interview',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

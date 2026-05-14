/**
 * Pipeline route-specs — `/api/pipeline/*`.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, jsonResponse, standardErrorResponses } from '../common';

const Application = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    job_id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    stage_id: z.string().uuid(),
    rejection_reason: z.string().nullable(),
    rating: z.number().int().min(1).max(5).nullable(),
    notes: z.string().nullable(),
    rejected_at: z.string().datetime().nullable(),
    hired_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('Application');

const Stage = z
  .object({
    id: z.string().uuid(),
    job_id: z.string().uuid(),
    name: z.string(),
    position: z.number().int(),
    color: z.string(),
    application_count: z.number().int().optional(),
  })
  .openapi('Stage');

registry.registerPath({
  method: 'get',
  path: '/api/pipeline/jobs/{jobId}/stages',
  tags: ['Pipeline'],
  summary: 'Get all stages for a job',
  security: authSecurity,
  request: { params: z.object({ jobId: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', z.array(Stage)) },
});

registry.registerPath({
  method: 'post',
  path: '/api/pipeline/jobs/{jobId}/stages',
  tags: ['Pipeline'],
  summary: 'Create new stage',
  security: authSecurity,
  request: {
    params: z.object({ jobId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(120),
            position: z.number().int().min(0).optional(),
            color: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: { 201: jsonResponse('Aangemaakt', Stage) },
});

registry.registerPath({
  method: 'patch',
  path: '/api/pipeline/stages/{stageId}',
  tags: ['Pipeline'],
  summary: 'Update stage (rename, reorder, recolor)',
  security: authSecurity,
  request: {
    params: z.object({ stageId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              name: z.string().optional(),
              position: z.number().int().optional(),
              color: z.string().optional(),
            })
            .partial(),
        },
      },
    },
  },
  responses: { 200: jsonResponse('OK', Stage) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/pipeline/stages/{stageId}',
  tags: ['Pipeline'],
  summary: 'Delete stage',
  description: 'Faalt als stage applications heeft — verplaats applications eerst.',
  security: authSecurity,
  request: { params: z.object({ stageId: z.string().uuid() }) },
  responses: { 204: { description: 'Verwijderd' }, 409: standardErrorResponses[400] },
});

registry.registerPath({
  method: 'get',
  path: '/api/pipeline/jobs/{jobId}/applications',
  tags: ['Pipeline'],
  summary: 'List applications for a job',
  security: authSecurity,
  request: {
    params: z.object({ jobId: z.string().uuid() }),
    query: z.object({
      stage_id: z.string().uuid().optional(),
      include_rejected: z.coerce.boolean().optional(),
    }),
  },
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(Application) })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/pipeline/applications',
  tags: ['Pipeline'],
  summary: 'Add candidate to job pipeline',
  description: 'Plaatst candidate in de eerste pipeline-stage van het job.',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            job_id: z.string().uuid(),
            candidate_id: z.string().uuid(),
            stage_id: z.string().uuid().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse('Aangemaakt', Application),
    409: jsonResponse('Kandidaat zit al in deze pipeline', z.object({})),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/pipeline/applications/{id}',
  tags: ['Pipeline'],
  summary: 'Update application — move stage, reject, hire, rate',
  description:
    'Stage-transitions emitten audit-events (`application.stage_changed`, `application.hired`, `application.rejected`) en webhook-events.',
  security: authSecurity,
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              stage_id: z.string().uuid().optional(),
              rejection_reason: z.string().optional(),
              rating: z.number().int().min(1).max(5).optional(),
              notes: z.string().optional(),
              hired: z.boolean().optional(),
            })
            .partial(),
        },
      },
    },
  },
  responses: { 200: jsonResponse('OK', Application) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/pipeline/applications/{id}',
  tags: ['Pipeline'],
  summary: 'Remove application from pipeline',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 204: { description: 'Verwijderd' } },
});

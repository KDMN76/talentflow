/**
 * OpenAPI route specs voor `/api/job-boards/*` — Sprint Q4.3 (Agent QQQ).
 *
 * 9 path-operations onder tag `Job Boards`. Schemas zijn pragmatisch: we
 * gebruiken `z.unknown()` voor de zwaarder geneste velden zodat de spec
 * compact blijft maar wel duidelijk wat de routes zijn.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

// ─── Reusable schemas ──────────────────────────────────────────────────────

const CatalogEntry = z
  .object({
    id: z.string(),
    display_name: z.string(),
    region: z.enum(['global', 'nl', 'de', 'eu']),
    auth_type: z.enum(['oauth2', 'api_key', 'xml_feed', 'none']),
    connected: z.boolean(),
    integration_id: z.string().uuid().nullable(),
  })
  .openapi('JobBoardCatalogEntry');

const Integration = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    board_id: z.string(),
    display_name: z.string().nullable(),
    status: z.enum(['connected', 'disconnected', 'error']),
    settings: z.record(z.unknown()),
    connected_by: z.string().uuid().nullable(),
    connected_at: z.string().datetime().nullable(),
    last_polled_at: z.string().datetime().nullable(),
    last_error: z.string().nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('JobBoardIntegration');

const Posting = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    job_id: z.string().uuid(),
    board_id: z.string(),
    integration_id: z.string().uuid().nullable(),
    external_id: z.string().nullable(),
    external_url: z.string().nullable(),
    status: z.enum([
      'queued',
      'posted',
      'rejected',
      'expired',
      'retracted',
      'failed',
    ]),
    posted_at: z.string().datetime().nullable(),
    expires_at: z.string().datetime().nullable(),
    retracted_at: z.string().datetime().nullable(),
    cost_amount: z.number().nullable(),
    cost_currency: z.string(),
    applicants_count: z.number().int(),
    last_polled_at: z.string().datetime().nullable(),
    metadata: z.record(z.unknown()),
    error_message: z.string().nullable(),
    created_by: z.string().uuid().nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('JobPosting');

const StatusEvent = z
  .object({
    id: z.string().uuid(),
    event: z.string(),
    payload: z.record(z.unknown()),
    created_at: z.string().datetime(),
  })
  .openapi('JobPostingStatusEvent');

const ConnectBody = z
  .object({
    credentials: z.record(z.unknown()),
    display_name: z.string().min(1).max(120).optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .openapi('JobBoardConnectBody');

const CreatePostingsBody = z
  .object({
    job_id: z.string().uuid(),
    board_ids: z.array(z.string()).min(1).max(20),
  })
  .openapi('CreateJobPostingsBody');

const CostPerHireRow = z
  .object({
    job_id: z.string().uuid(),
    application_id: z.string().uuid().nullable(),
    posting_id: z.string().uuid().nullable(),
    source_board_id: z.string().nullable(),
    attributed_cost: z.number().nullable(),
    currency: z.string(),
    computed_at: z.string().datetime(),
  })
  .openapi('CostPerHireRow');

// ─── Path operations ──────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/job-boards/integrations',
  tags: ['Job Boards'],
  summary: 'List configured job-board integrations',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(Integration) })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/job-boards/catalog',
  tags: ['Job Boards'],
  summary: 'List supported boards (with connection state)',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(CatalogEntry) })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/job-boards/integrations/{boardId}/connect',
  tags: ['Job Boards'],
  summary: 'Connect a board (encrypts credentials)',
  security: authSecurity,
  request: {
    params: z.object({ boardId: z.string() }),
    body: { content: { 'application/json': { schema: ConnectBody } } },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: Integration })),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/job-boards/integrations/{boardId}',
  tags: ['Job Boards'],
  summary: 'Disconnect board + retract live postings',
  security: authSecurity,
  request: { params: z.object({ boardId: z.string() }) },
  responses: { 204: { description: 'Disconnected' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/job-boards/postings',
  tags: ['Job Boards'],
  summary: 'List external job postings (paginated)',
  security: authSecurity,
  request: {
    query: z.object({
      job_id: z.string().uuid().optional(),
      status: z
        .enum([
          'queued',
          'posted',
          'rejected',
          'expired',
          'retracted',
          'failed',
        ])
        .optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(Posting),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/job-boards/postings/{id}',
  tags: ['Job Boards'],
  summary: 'Posting details + last 20 status events',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({ posting: Posting, events: z.array(StatusEvent) })
    ),
    404: { description: 'Niet gevonden' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/job-boards/postings',
  tags: ['Job Boards'],
  summary: 'Enqueue postings on one or more boards',
  security: authSecurity,
  request: {
    body: { content: { 'application/json': { schema: CreatePostingsBody } } },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: z.array(Posting) })),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/job-boards/postings/{id}',
  tags: ['Job Boards'],
  summary: 'Retract a posting',
  security: authSecurity,
  request: { params: idParam },
  responses: { 204: { description: 'Retracted' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/job-boards/cost-per-hire',
  tags: ['Job Boards'],
  summary: 'Cost-per-hire records (optional filter by job_id)',
  security: authSecurity,
  request: {
    query: z.object({ job_id: z.string().uuid().optional() }),
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(CostPerHireRow) })),
  },
});

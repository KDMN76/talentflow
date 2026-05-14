/**
 * OpenAPI route specs voor `/api/timesheets/*` — Sprint Q4.4 (Agent TTT).
 *
 * Tag: `Timesheets`. Inclusief de public-portal routes onder `/api/public/
 * timesheets/{token}/*` (no auth) zodat de spec compleet is.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

const statusEnum = z.enum([
  'draft',
  'submitted',
  'approved',
  'rejected',
  'disputed',
]);

const Timesheet = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    contract_id: z.string().uuid(),
    candidate_id: z.string().uuid().nullable(),
    week_start: z.string(),
    week_end: z.string(),
    status: statusEnum,
    total_hours: z.number(),
    total_overtime_hours: z.number(),
    notes: z.string().nullable(),
    submitted_at: z.string().datetime().nullable(),
    approved_at: z.string().datetime().nullable(),
    approved_by: z.string().uuid().nullable(),
    rejected_at: z.string().datetime().nullable(),
    rejection_reason: z.string().nullable(),
    metadata: z.record(z.unknown()),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('Timesheet');

const TimesheetEntry = z
  .object({
    id: z.string().uuid(),
    timesheet_id: z.string().uuid(),
    date: z.string(),
    hours: z.number(),
    overtime_hours: z.number(),
    break_minutes: z.number().int(),
    description: z.string().nullable(),
    project_code: z.string().nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('TimesheetEntry');

const CreateTimesheetBody = z
  .object({
    contract_id: z.string().uuid(),
    week_start: z.string(),
    candidate_id: z.string().uuid().nullable().optional(),
  })
  .openapi('CreateTimesheetBody');

const EntryBody = z
  .object({
    date: z.string(),
    hours: z.number().min(0).max(24),
    overtime_hours: z.number().min(0).max(24).optional(),
    break_minutes: z.number().int().min(0).optional(),
    description: z.string().nullable().optional(),
    project_code: z.string().nullable().optional(),
  })
  .openapi('TimesheetEntryBody');

const ReasonBody = z
  .object({ reason: z.string() })
  .openapi('TimesheetReasonBody');

const BillingSummary = z
  .object({
    total_hours: z.number(),
    total_overtime_hours: z.number(),
    total_amount_candidate: z.number(),
    total_amount_client: z.number(),
    currency: z.string(),
    by_week: z.array(
      z.object({
        week_start: z.string(),
        week_end: z.string().optional(),
        hours: z.number(),
        overtime_hours: z.number(),
        amount_candidate: z.number(),
        amount_client: z.number(),
      })
    ),
  })
  .openapi('TimesheetBillingSummary');

// ───────────────────────────────────────────────────────────────────────────
// Path operations
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/timesheets',
  tags: ['Timesheets'],
  summary: 'List timesheets (paginated cursor)',
  security: authSecurity,
  request: {
    query: z.object({
      contract_id: z.string().uuid().optional(),
      status: statusEnum.optional(),
      week_start: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(Timesheet),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/timesheets',
  tags: ['Timesheets'],
  summary: 'Get-or-create the timesheet for (contract, week_start)',
  security: authSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: CreateTimesheetBody } },
    },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: Timesheet })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/timesheets/summary',
  tags: ['Timesheets'],
  summary: 'Billing summary — used by invoicing service',
  security: authSecurity,
  request: {
    query: z.object({
      contract_id: z.string().uuid(),
      period_start: z.string(),
      period_end: z.string(),
    }),
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: BillingSummary })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/timesheets/approver-queue',
  tags: ['Timesheets'],
  summary: 'List submitted timesheets waiting for approval',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(Timesheet) })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/timesheets/{id}',
  tags: ['Timesheets'],
  summary: 'Get a timesheet (incl. entries)',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: Timesheet.extend({ entries: z.array(TimesheetEntry) }),
      })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/timesheets/{id}/audit',
  tags: ['Timesheets'],
  summary: 'List per-row diff audit entries',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({ data: z.array(z.record(z.unknown())) })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/timesheets/{id}/entries',
  tags: ['Timesheets'],
  summary: 'Add or update an entry (per day)',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: EntryBody } } },
  },
  responses: {
    201: jsonResponse(
      'Aangemaakt',
      z.object({
        data: z.object({
          entry: TimesheetEntry,
          totals: z.object({
            total_hours: z.number(),
            total_overtime_hours: z.number(),
          }),
        }),
      })
    ),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/timesheets/{id}/entries/{entryId}',
  tags: ['Timesheets'],
  summary: 'Update an existing entry (upserts on date)',
  security: authSecurity,
  request: {
    params: z.object({
      id: z.string().uuid(),
      entryId: z.string().uuid(),
    }),
    body: { content: { 'application/json': { schema: EntryBody } } },
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.object({
          entry: TimesheetEntry,
          totals: z.object({
            total_hours: z.number(),
            total_overtime_hours: z.number(),
          }),
        }),
      })
    ),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/timesheets/{id}/entries/{entryId}',
  tags: ['Timesheets'],
  summary: 'Delete an entry',
  security: authSecurity,
  request: {
    params: z.object({
      id: z.string().uuid(),
      entryId: z.string().uuid(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.object({
          totals: z.object({
            total_hours: z.number(),
            total_overtime_hours: z.number(),
          }),
        }),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/timesheets/{id}/submit',
  tags: ['Timesheets'],
  summary: 'Candidate submits a timesheet (draft → submitted)',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse('OK', z.object({ data: Timesheet })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/timesheets/{id}/approve',
  tags: ['Timesheets'],
  summary: 'Client / recruiter / admin approves a timesheet',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse('OK', z.object({ data: Timesheet })),
    403: { description: 'Approver-rol niet toegestaan' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/timesheets/{id}/reject',
  tags: ['Timesheets'],
  summary: 'Reject a submitted timesheet',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: ReasonBody } } },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: Timesheet })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/timesheets/{id}/dispute',
  tags: ['Timesheets'],
  summary: 'Dispute a non-draft, non-approved timesheet',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: ReasonBody } } },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: Timesheet })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/timesheets/portal-tokens',
  tags: ['Timesheets'],
  summary: 'Create a single-use timesheet portal token for a candidate',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            contract_id: z.string().uuid(),
            candidate_id: z.string().uuid(),
            ttl_days: z.number().int().min(1).max(365).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse(
      'Aangemaakt',
      z.object({
        data: z.object({
          id: z.string().uuid(),
          token: z.string(),
          expires_at: z.string().datetime(),
        }),
      })
    ),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/timesheets/portal-tokens/{id}',
  tags: ['Timesheets'],
  summary: 'Revoke a portal token',
  security: authSecurity,
  request: { params: idParam },
  responses: { 204: { description: 'Revoked' } },
});

// ───────────────────────────────────────────────────────────────────────────
// Public token routes
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/public/timesheets/{token}',
  tags: ['Timesheets', 'Public'],
  summary: 'Public — load active week timesheet via portal-token',
  request: {
    params: z.object({ token: z.string() }),
    query: z.object({ week_start: z.string().optional() }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.object({
          contract_id: z.string().uuid(),
          candidate_id: z.string().uuid(),
          timesheet: Timesheet.extend({ entries: z.array(TimesheetEntry) }),
          token_expires_at: z.string().datetime(),
        }),
      })
    ),
    401: { description: 'Token ongeldig of verlopen' },
    429: { description: 'Rate-limit overschreden' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/public/timesheets/{token}/entries',
  tags: ['Timesheets', 'Public'],
  summary: 'Public — candidate adds/updates entry via token',
  request: {
    params: z.object({ token: z.string() }),
    body: { content: { 'application/json': { schema: EntryBody } } },
  },
  responses: {
    201: jsonResponse(
      'Aangemaakt',
      z.object({
        data: z.object({
          entry: TimesheetEntry,
          totals: z.object({
            total_hours: z.number(),
            total_overtime_hours: z.number(),
          }),
        }),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/public/timesheets/{token}/submit',
  tags: ['Timesheets', 'Public'],
  summary: 'Public — candidate submits the active week timesheet',
  request: {
    params: z.object({ token: z.string() }),
    query: z.object({ week_start: z.string().optional() }),
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: Timesheet })),
  },
});

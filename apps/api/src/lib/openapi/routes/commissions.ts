/**
 * OpenAPI route specs voor `/api/commissions/*` — Sprint Q4.4 (Agent UUU).
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

const SchemeType = z.enum([
  'flat',
  'percent_of_fee',
  'percent_of_margin',
  'tiered',
  'recurring_monthly',
]);

const Scheme = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    type: SchemeType,
    config: z.record(z.unknown()),
    active: z.boolean(),
    is_default: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('CommissionScheme');

const Assignment = z
  .object({
    id: z.string().uuid(),
    recruiter_id: z.string().uuid().nullable(),
    contract_id: z.string().uuid(),
    scheme_id: z.string().uuid(),
    share_percent: z.number(),
    notes: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('CommissionAssignment');

const Record = z
  .object({
    id: z.string().uuid(),
    assignment_id: z.string().uuid(),
    recruiter_id: z.string().uuid().nullable(),
    contract_id: z.string().uuid().nullable(),
    invoice_id: z.string().uuid().nullable(),
    base_amount: z.number(),
    commission_amount: z.number(),
    period_start: z.string().nullable(),
    period_end: z.string().nullable(),
    status: z.enum(['pending', 'approved', 'paid', 'disputed']),
    paid_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('CommissionRecord');

registry.registerPath({
  method: 'get',
  path: '/api/commissions/schemes',
  tags: ['Commissions'],
  summary: 'List commission schemes',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(Scheme) })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/commissions/schemes',
  tags: ['Commissions'],
  summary: 'Create scheme',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string(),
            type: SchemeType,
            config: z.record(z.unknown()),
            active: z.boolean().optional(),
            is_default: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: Scheme })),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/commissions/schemes/{id}',
  tags: ['Commissions'],
  summary: 'Update scheme',
  security: authSecurity,
  request: {
    params: idParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().optional(),
            config: z.record(z.unknown()).optional(),
            active: z.boolean().optional(),
            is_default: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: { 200: jsonResponse('OK', z.object({ data: Scheme })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/commissions/assignments',
  tags: ['Commissions'],
  summary: 'List assignments',
  security: authSecurity,
  request: {
    query: z.object({
      contract_id: z.string().uuid().optional(),
      recruiter_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(Assignment) })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/commissions/assignments',
  tags: ['Commissions'],
  summary: 'Assign scheme to recruiter on contract',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            contract_id: z.string().uuid(),
            recruiter_id: z.string().uuid().nullable(),
            scheme_id: z.string().uuid(),
            share_percent: z.number().optional(),
            notes: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: Assignment })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/commissions/records',
  tags: ['Commissions'],
  summary: 'List commission records (cursor-paginated)',
  security: authSecurity,
  request: {
    query: z.object({
      recruiter_id: z.string().uuid().optional(),
      status: z.enum(['pending', 'approved', 'paid', 'disputed']).optional(),
      contract_id: z.string().uuid().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(Record),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/commissions/records/{id}/approve',
  tags: ['Commissions'],
  summary: 'Approve commission record',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: Record })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/commissions/records/{id}/pay',
  tags: ['Commissions'],
  summary: 'Mark commission paid',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: Record })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/commissions/records/{id}/dispute',
  tags: ['Commissions'],
  summary: 'Dispute commission',
  security: authSecurity,
  request: {
    params: idParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({ reason: z.string().min(2) }),
        },
      },
    },
  },
  responses: { 200: jsonResponse('OK', z.object({ data: Record })) },
});

/**
 * OpenAPI route specs voor `/api/invoices/*` — Sprint Q4.4 (Agent UUU).
 *
 * Tag: `Billing`. 8 path-operations.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

const Invoice = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    invoice_number: z.string(),
    client_organization_id: z.string().uuid().nullable(),
    contract_id: z.string().uuid().nullable(),
    status: z.enum(['draft', 'sent', 'paid', 'overdue', 'void']),
    period_start: z.string().nullable(),
    period_end: z.string().nullable(),
    issued_date: z.string().nullable(),
    due_date: z.string().nullable(),
    paid_date: z.string().nullable(),
    subtotal_amount: z.number(),
    vat_rate: z.number(),
    vat_amount: z.number(),
    total_amount: z.number(),
    currency: z.string(),
    notes: z.string().nullable(),
    pdf_storage_key: z.string().nullable(),
    external_accounting_id: z.string().nullable(),
    external_accounting_provider: z
      .enum(['exact_online', 'twinfield', 'snelstart'])
      .nullable(),
    external_synced_at: z.string().nullable(),
    created_by: z.string().uuid().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Invoice');

const InvoiceLine = z
  .object({
    id: z.string().uuid(),
    invoice_id: z.string().uuid(),
    description: z.string(),
    quantity: z.number(),
    unit: z.string(),
    unit_price: z.number(),
    line_total: z.number(),
    vat_rate: z.number().nullable(),
    metadata: z.record(z.unknown()),
    created_at: z.string(),
  })
  .openapi('InvoiceLine');

const CreateBody = z
  .object({
    contract_id: z.string().uuid(),
    period_start: z.string(),
    period_end: z.string(),
    aggregate: z.enum(['week', 'month', 'flat']).optional(),
    vat_rate: z.number().min(0).max(100).optional(),
    notes: z.string().nullable().optional(),
  })
  .openapi('GenerateInvoiceBody');

registry.registerPath({
  method: 'get',
  path: '/api/invoices',
  tags: ['Billing'],
  summary: 'List invoices (filterable, cursor-paginated)',
  security: authSecurity,
  request: {
    query: z.object({
      status: z.enum(['draft', 'sent', 'paid', 'overdue', 'void']).optional(),
      client_organization_id: z.string().uuid().optional(),
      contract_id: z.string().uuid().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({ data: z.array(Invoice), next_cursor: z.string().nullable() })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/invoices',
  tags: ['Billing'],
  summary: 'Generate invoice from approved timesheets on a contract',
  security: authSecurity,
  request: {
    body: { content: { 'application/json': { schema: CreateBody } } },
  },
  responses: {
    201: jsonResponse(
      'Aangemaakt',
      z.object({ invoice: Invoice, lines: z.array(InvoiceLine) })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/invoices/{id}',
  tags: ['Billing'],
  summary: 'Invoice + lines',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({ invoice: Invoice, lines: z.array(InvoiceLine) })
    ),
    404: { description: 'Niet gevonden' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/invoices/{id}/issue',
  tags: ['Billing'],
  summary: 'Issue (draft → sent), render PDF, trigger commissions',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: Invoice })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/invoices/{id}/mark-paid',
  tags: ['Billing'],
  summary: 'Mark invoice paid',
  security: authSecurity,
  request: {
    params: idParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({ paid_date: z.string() }),
        },
      },
    },
  },
  responses: { 200: jsonResponse('OK', z.object({ data: Invoice })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/invoices/{id}/void',
  tags: ['Billing'],
  summary: 'Void invoice',
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
  responses: { 200: jsonResponse('OK', z.object({ data: Invoice })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/invoices/{id}/pdf',
  tags: ['Billing'],
  summary: 'Stream invoice as PDF',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: {
      description: 'PDF stream',
      content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/invoices/{id}/sync-accounting',
  tags: ['Billing'],
  summary: 'Push invoice to tenant\'s primary accounting integration',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.object({
          external_id: z.string(),
          provider: z.string(),
          already_synced: z.boolean(),
        }),
      })
    ),
  },
});

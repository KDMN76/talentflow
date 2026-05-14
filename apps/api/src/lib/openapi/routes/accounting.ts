/**
 * OpenAPI route specs voor `/api/accounting/*` — Sprint Q4.4 (Agent UUU).
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, jsonResponse } from '../common';

const Catalog = z
  .object({
    id: z.enum(['exact_online', 'twinfield', 'snelstart']),
    display_name: z.string(),
    connected: z.boolean(),
    integration_id: z.string().uuid().nullable(),
  })
  .openapi('AccountingCatalogEntry');

const Integration = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    provider: z.enum(['exact_online', 'twinfield', 'snelstart']),
    status: z.enum(['connected', 'disconnected', 'error']),
    display_name: z.string().nullable(),
    settings: z.record(z.unknown()),
    default_revenue_account: z.string().nullable(),
    default_vat_code: z.string().nullable(),
    connected_by: z.string().uuid().nullable(),
    connected_at: z.string().nullable(),
    last_synced_at: z.string().nullable(),
    last_error: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('AccountingIntegration');

const ConnectBody = z
  .object({
    credentials: z.record(z.unknown()),
    display_name: z.string().min(1).max(120).optional(),
    settings: z.record(z.unknown()).optional(),
    default_revenue_account: z.string().nullable().optional(),
    default_vat_code: z.string().nullable().optional(),
  })
  .openapi('AccountingConnectBody');

registry.registerPath({
  method: 'get',
  path: '/api/accounting/catalog',
  tags: ['Accounting'],
  summary: 'List supported accounting providers',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(Catalog) })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/accounting/integrations',
  tags: ['Accounting'],
  summary: 'List configured accounting integrations',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(Integration) })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/accounting/integrations/{provider}/connect',
  tags: ['Accounting'],
  summary: 'Connect provider (encrypts credentials)',
  security: authSecurity,
  request: {
    params: z.object({
      provider: z.enum(['exact_online', 'twinfield', 'snelstart']),
    }),
    body: { content: { 'application/json': { schema: ConnectBody } } },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: Integration })),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/accounting/integrations/{provider}',
  tags: ['Accounting'],
  summary: 'Disconnect provider',
  security: authSecurity,
  request: {
    params: z.object({
      provider: z.enum(['exact_online', 'twinfield', 'snelstart']),
    }),
  },
  responses: { 204: { description: 'Disconnected' } },
});

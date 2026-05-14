/**
 * Reports route-specs — `/api/reports/*`.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

const ReportConfig = z
  .object({
    dimensions: z.array(z.string()),
    metrics: z.array(z.string()),
    filters: z.record(z.unknown()).optional(),
    granularity: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
    chart_type: z.enum(['table', 'bar', 'line', 'pie', 'funnel', 'kpi']).optional(),
  })
  .openapi('ReportConfig');

const Report = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    config: ReportConfig,
    embed_token: z.string().nullable(),
    schedule_cron: z.string().nullable(),
    last_run_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('Report');

const ReportRun = z
  .object({
    id: z.string().uuid(),
    report_id: z.string().uuid(),
    rows: z.array(z.record(z.unknown())),
    metadata: z.object({
      executed_at: z.string().datetime(),
      duration_ms: z.number().int(),
      row_count: z.number().int(),
    }),
  })
  .openapi('ReportRun');

registry.registerPath({
  method: 'get',
  path: '/api/reports',
  tags: ['Reports'],
  summary: 'List reports',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(Report)) },
});

registry.registerPath({
  method: 'post',
  path: '/api/reports',
  tags: ['Reports'],
  summary: 'Create report',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(200),
            description: z.string().optional(),
            config: ReportConfig,
          }),
        },
      },
    },
  },
  responses: { 201: jsonResponse('Aangemaakt', Report) },
});

registry.registerPath({
  method: 'get',
  path: '/api/reports/templates',
  tags: ['Reports'],
  summary: 'List report templates',
  security: authSecurity,
  responses: {
    200: jsonResponse(
      'OK',
      z.array(
        z.object({ id: z.string(), name: z.string(), description: z.string(), config: ReportConfig })
      )
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reports/dimensions',
  tags: ['Reports'],
  summary: 'List available dimensions',
  security: authSecurity,
  responses: {
    200: jsonResponse(
      'OK',
      z.array(z.object({ key: z.string(), label: z.string(), category: z.string() }))
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reports/metrics',
  tags: ['Reports'],
  summary: 'List available metrics',
  security: authSecurity,
  responses: {
    200: jsonResponse(
      'OK',
      z.array(
        z.object({ key: z.string(), label: z.string(), unit: z.string(), aggregation: z.string() })
      )
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reports/{id}',
  tags: ['Reports'],
  summary: 'Get report',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', Report) },
});

registry.registerPath({
  method: 'patch',
  path: '/api/reports/{id}',
  tags: ['Reports'],
  summary: 'Update report',
  security: authSecurity,
  request: {
    params: idParam,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              name: z.string().optional(),
              description: z.string().optional(),
              config: ReportConfig.optional(),
            })
            .partial(),
        },
      },
    },
  },
  responses: { 200: jsonResponse('OK', Report) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/reports/{id}',
  tags: ['Reports'],
  summary: 'Delete report',
  security: authSecurity,
  request: { params: idParam },
  responses: { 204: { description: 'Verwijderd' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/reports/{id}/duplicate',
  tags: ['Reports'],
  summary: 'Duplicate report',
  security: authSecurity,
  request: { params: idParam },
  responses: { 201: jsonResponse('Aangemaakt', Report) },
});

registry.registerPath({
  method: 'post',
  path: '/api/reports/{id}/run',
  tags: ['Reports'],
  summary: 'Execute report',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', ReportRun) },
});

registry.registerPath({
  method: 'get',
  path: '/api/reports/{id}/runs',
  tags: ['Reports'],
  summary: 'List historical runs',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.array(ReportRun)) },
});

registry.registerPath({
  method: 'post',
  path: '/api/reports/{id}/embed',
  tags: ['Reports'],
  summary: 'Enable public embed',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({ embed_token: z.string(), embed_url: z.string().url() })
    ),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/reports/{id}/embed',
  tags: ['Reports'],
  summary: 'Disable public embed',
  security: authSecurity,
  request: { params: idParam },
  responses: { 204: { description: 'Embed uitgeschakeld' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/reports/{id}/export/pdf',
  tags: ['Reports'],
  summary: 'Export report as PDF',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: {
      description: 'PDF',
      content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reports/{id}/export/excel',
  tags: ['Reports'],
  summary: 'Export report as Excel',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Excel',
      content: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reports/{id}/export/csv',
  tags: ['Reports'],
  summary: 'Export report as CSV',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: { description: 'CSV', content: { 'text/csv': { schema: z.string() } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/reports/{id}/schedule',
  tags: ['Reports'],
  summary: 'Schedule report run (cron)',
  security: authSecurity,
  request: {
    params: idParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            cron: z.string().openapi({ example: '0 8 * * MON' }),
            recipients: z.array(z.string().email()),
            export_format: z.enum(['pdf', 'excel', 'csv']),
          }),
        },
      },
    },
  },
  responses: { 200: jsonResponse('OK', Report) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/reports/{id}/schedule',
  tags: ['Reports'],
  summary: 'Clear schedule',
  security: authSecurity,
  request: { params: idParam },
  responses: { 204: { description: 'Schedule verwijderd' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/reports/embed/{token}/run',
  tags: ['Reports', 'Public'],
  summary: 'Run report via embed-token (public)',
  description: 'Geen auth — token is opaque en kan ingetrokken worden via DELETE /api/reports/{id}/embed.',
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: jsonResponse('OK', ReportRun) },
});

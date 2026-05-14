/**
 * OpenAPI route specs voor `/api/forecasting/*` — Sprint Q4.4 (Agent UUU).
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, jsonResponse } from '../common';

const Forecast = z
  .object({
    id: z.string().uuid(),
    forecast_month: z.string(),
    expected_revenue: z.number(),
    pipeline_revenue: z.number(),
    hires_in_pipeline: z.number().int(),
    active_contracts: z.number().int(),
    computed_at: z.string(),
  })
  .openapi('RevenueForecast');

const MarginRow = z
  .object({
    group_id: z.string().nullable(),
    group_label: z.string().nullable(),
    total_revenue: z.number(),
    total_cost: z.number(),
    margin_amount: z.number(),
    margin_pct: z.number(),
    invoice_count: z.number().int(),
  })
  .openapi('MarginReportRow');

registry.registerPath({
  method: 'get',
  path: '/api/forecasting/revenue',
  tags: ['Forecasting'],
  summary: 'Get revenue forecast snapshots for upcoming months',
  security: authSecurity,
  request: {
    query: z.object({
      months_ahead: z.coerce.number().int().min(1).max(24).optional(),
    }),
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(Forecast) })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/forecasting/margin',
  tags: ['Forecasting'],
  summary: 'Margin report grouped by client or recruiter',
  security: authSecurity,
  request: {
    query: z.object({
      group_by: z.enum(['client', 'recruiter']),
      period_start: z.string().optional(),
      period_end: z.string().optional(),
    }),
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(MarginRow) })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/forecasting/recompute',
  tags: ['Forecasting'],
  summary: 'Recompute forecast for current tenant (admin only)',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(Forecast) })),
  },
});

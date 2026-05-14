/**
 * Compliance route-specs — `/api/compliance/*` + self-service portal.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

const RetentionPolicy = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    entity: z.enum(['candidate', 'application']),
    retention_days: z.number().int().positive(),
    action: z.enum(['anonymize', 'delete']),
    active: z.boolean(),
    created_at: z.string().datetime(),
  })
  .openapi('RetentionPolicy');

const DsarRequest = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    candidate_id: z.string().uuid().nullable(),
    email: z.string().email(),
    request_type: z.enum(['export', 'deletion', 'rectification']),
    status: z.enum(['pending', 'in_progress', 'fulfilled', 'rejected']),
    fulfilled_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('DsarRequest');

const AuditEvent = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    actor_user_id: z.string().uuid().nullable(),
    action: z.string(),
    resource_type: z.string().nullable(),
    resource_id: z.string().nullable(),
    metadata: z.record(z.unknown()).nullable(),
    occurred_at: z.string().datetime(),
  })
  .openapi('AuditEvent');

const AiEvent = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    feature: z.string(),
    model: z.string(),
    prompt_tokens: z.number().int(),
    completion_tokens: z.number().int(),
    cost_usd: z.number(),
    occurred_at: z.string().datetime(),
  })
  .openapi('AiEvent');

registry.registerPath({
  method: 'get',
  path: '/api/compliance/retention-policies',
  tags: ['Compliance'],
  summary: 'List retention policies',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(RetentionPolicy)) },
});

registry.registerPath({
  method: 'post',
  path: '/api/compliance/retention-policies',
  tags: ['Compliance'],
  summary: 'Create retention policy (admin)',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            entity: z.enum(['candidate', 'application']),
            retention_days: z.number().int().positive(),
            action: z.enum(['anonymize', 'delete']),
            active: z.boolean().default(true),
          }),
        },
      },
    },
  },
  responses: { 201: jsonResponse('Aangemaakt', RetentionPolicy) },
});

registry.registerPath({
  method: 'get',
  path: '/api/compliance/dsar-requests',
  tags: ['Compliance'],
  summary: 'List DSAR requests',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(DsarRequest)) },
});

registry.registerPath({
  method: 'post',
  path: '/api/compliance/dsar-requests',
  tags: ['Compliance'],
  summary: 'Create DSAR request',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string().email(),
            candidate_id: z.string().uuid().optional(),
            request_type: z.enum(['export', 'deletion', 'rectification']),
          }),
        },
      },
    },
  },
  responses: { 201: jsonResponse('Aangemaakt', DsarRequest) },
});

registry.registerPath({
  method: 'get',
  path: '/api/compliance/dsar-requests/{id}/export',
  tags: ['Compliance'],
  summary: 'Download DSAR export bundle (ZIP)',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: { description: 'ZIP', content: { 'application/zip': { schema: z.string().openapi({ format: 'binary' }) } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/compliance/audit-events',
  tags: ['Compliance'],
  summary: 'Browse audit-trail',
  security: authSecurity,
  request: {
    query: z.object({
      action: z.string().optional(),
      actor_user_id: z.string().uuid().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.coerce.number().int().max(500).default(100),
    }),
  },
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(AuditEvent) })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/compliance/ai-events',
  tags: ['Compliance'],
  summary: 'AI-events log (EU AI Act compliance)',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(AiEvent) })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/compliance/pay-equity/snapshots',
  tags: ['Compliance'],
  summary: 'Pay-equity snapshots (Directive 2026)',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(z.unknown()) })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/compliance/pay-equity',
  tags: ['Compliance'],
  summary: 'Generate pay-equity report',
  security: authSecurity,
  responses: { 202: jsonResponse('Gestart', z.object({ snapshot_id: z.string().uuid() })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/compliance/dei-funnel/snapshots',
  tags: ['Compliance'],
  summary: 'DEI funnel snapshots',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(z.unknown()) })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/compliance/dei-funnel',
  tags: ['Compliance'],
  summary: 'Generate DEI funnel snapshot',
  security: authSecurity,
  responses: { 202: jsonResponse('Gestart', z.object({ snapshot_id: z.string().uuid() })) },
});

// ─── Self-service (public) ────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/self-service/access-request',
  tags: ['Compliance', 'Public'],
  summary: 'Candidate self-service access request',
  description: 'Geen auth. Genereert magic-link → kandidaat krijgt e-mail met token.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ email: z.string().email(), tenant_slug: z.string().min(1) }),
        },
      },
    },
  },
  responses: { 200: jsonResponse('Mail verstuurd', z.object({ message: z.string() })) },
});

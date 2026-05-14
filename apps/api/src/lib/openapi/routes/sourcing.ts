/**
 * Sourcing-Agent route specs — Sprint Q4.5 (Agent WWW).
 *
 * `/api/sourcing/*` — autonome boolean-search agent. EU AI Act art. 13
 * compliant: élke surfaced candidate is overrideable, élke run heeft een
 * volledig reasoning_log + WORM action-trail.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, jsonResponse } from '../common';

// ─── Schemas ───────────────────────────────────────────────────────────────

const AgentBriefSchema = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    job_id: z.string().uuid().nullable(),
    brief_text: z.string(),
    must_have: z.array(z.string()),
    nice_to_have: z.array(z.string()),
    exclusions: z.array(z.string()),
    target_count: z.number().int(),
    search_locations: z.array(z.string()),
    language_preferences: z.array(z.string()),
    active: z.boolean(),
    created_by: z.string().uuid().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('AgentBrief');

const CreateBriefBody = z
  .object({
    job_id: z.string().uuid().nullable().optional(),
    brief_text: z.string().min(20).max(20_000).openapi({
      example: 'Senior React-developer met 5+ jaar ervaring in Amsterdam, niet uit banking.',
    }),
    must_have: z.array(z.string()).optional(),
    nice_to_have: z.array(z.string()).optional(),
    exclusions: z.array(z.string()).optional(),
    target_count: z.number().int().min(1).max(500).optional(),
    search_locations: z.array(z.string()).optional(),
    language_preferences: z.array(z.string()).optional(),
  })
  .openapi('CreateBriefBody');

const AgentRunSchema = z
  .object({
    id: z.string().uuid(),
    brief_id: z.string().uuid(),
    status: z.enum(['queued', 'running', 'review_required', 'completed', 'failed', 'cancelled']),
    trigger: z.enum(['manual', 'scheduled', 'reactivation', 'expansion']),
    started_at: z.string().datetime().nullable(),
    finished_at: z.string().datetime().nullable(),
    candidates_found: z.number().int(),
    candidates_approved: z.number().int(),
    candidates_rejected: z.number().int(),
    expansion_iteration: z.number().int(),
    reasoning_log: z.array(z.record(z.unknown())),
    error_message: z.string().nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('AgentRun');

const AgentFindingSchema = z
  .object({
    id: z.string().uuid(),
    run_id: z.string().uuid(),
    brief_id: z.string().uuid(),
    candidate_id: z.string().uuid().nullable(),
    external_source: z.string().nullable(),
    external_url: z.string().nullable(),
    external_id: z.string().nullable(),
    full_name: z.string().nullable(),
    current_title: z.string().nullable(),
    current_company: z.string().nullable(),
    location: z.string().nullable(),
    headline: z.string().nullable(),
    summary: z.string().nullable(),
    skills: z.array(z.string()),
    languages: z.array(z.string()),
    match_score: z.number().nullable(),
    match_reasoning: z.string().nullable(),
    status: z.enum(['pending_review', 'approved', 'rejected', 'contacted', 'dismissed']),
    reviewed_at: z.string().datetime().nullable(),
    reviewed_by: z.string().uuid().nullable(),
    review_note: z.string().nullable(),
    metadata: z.record(z.unknown()),
    created_at: z.string().datetime(),
  })
  .openapi('AgentFinding');

const AgentActionSchema = z
  .object({
    id: z.string().uuid(),
    run_id: z.string().uuid(),
    finding_id: z.string().uuid().nullable(),
    action: z.string(),
    payload: z.record(z.unknown()),
    reasoning: z.string().nullable(),
    ai_model: z.string().nullable(),
    prompt_tokens: z.number().int().nullable(),
    completion_tokens: z.number().int().nullable(),
    cost_usd: z.number().nullable(),
    requires_approval: z.boolean(),
    approved_by: z.string().uuid().nullable(),
    approved_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('AgentAction');

const AgentMemorySchema = z
  .object({
    id: z.string().uuid(),
    scope: z.enum(['tenant', 'recruiter', 'brief']),
    scope_id: z.string().uuid().nullable(),
    key: z.string(),
    value: z.unknown(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('AgentMemory');

// ─── Briefs ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/sourcing/briefs',
  tags: ['Sourcing Agent'],
  summary: 'List sourcing briefs',
  security: authSecurity,
  request: {
    query: z.object({
      job_id: z.string().uuid().optional(),
      active: z.enum(['true', 'false']).optional(),
      cursor: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse('OK', z.object({
      data: z.array(AgentBriefSchema),
      nextCursor: z.string().uuid().nullable(),
    })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/sourcing/briefs',
  tags: ['Sourcing Agent'],
  summary: 'Create a sourcing brief (Claude or mock parses it into requirements)',
  description:
    'De brief_text wordt door Claude (of mock-mode regex-parser) geanalyseerd. Recruiter kan velden overrulen door ze expliciet mee te sturen.',
  security: authSecurity,
  request: {
    body: { content: { 'application/json': { schema: CreateBriefBody } } },
  },
  responses: { 201: jsonResponse('Created', z.object({ data: AgentBriefSchema })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/sourcing/briefs/{id}',
  tags: ['Sourcing Agent'],
  summary: 'Get a sourcing brief',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', z.object({ data: AgentBriefSchema })) },
});

registry.registerPath({
  method: 'patch',
  path: '/api/sourcing/briefs/{id}',
  tags: ['Sourcing Agent'],
  summary: 'Update a sourcing brief',
  security: authSecurity,
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { 'application/json': { schema: CreateBriefBody.partial() } } },
  },
  responses: { 200: jsonResponse('OK', z.object({ data: AgentBriefSchema })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/sourcing/briefs/{id}/archive',
  tags: ['Sourcing Agent'],
  summary: 'Archive a sourcing brief (soft-delete)',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', z.object({ data: AgentBriefSchema })) },
});

// ─── Runs ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/sourcing/briefs/{id}/runs',
  tags: ['Sourcing Agent'],
  summary: 'Trigger a new agent run',
  description:
    'Maakt een queued run en stuurt deze naar BullMQ. EU AI Act art. 13: elke run produceert een volledig agent_actions audit-trail.',
  security: authSecurity,
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { 'application/json': { schema: z.object({
      trigger: z.enum(['manual', 'scheduled', 'reactivation', 'expansion']).optional(),
    }) } } },
  },
  responses: { 202: jsonResponse('Accepted', z.object({ data: AgentRunSchema })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/sourcing/runs',
  tags: ['Sourcing Agent'],
  summary: 'List agent runs',
  security: authSecurity,
  request: {
    query: z.object({
      status: z.enum(['queued', 'running', 'review_required', 'completed', 'failed', 'cancelled']).optional(),
      brief_id: z.string().uuid().optional(),
      cursor: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse('OK', z.object({
      data: z.array(AgentRunSchema),
      nextCursor: z.string().uuid().nullable(),
    })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/sourcing/runs/{runId}',
  tags: ['Sourcing Agent'],
  summary: 'Get a run with reasoning_log + recent actions',
  security: authSecurity,
  request: { params: z.object({ runId: z.string().uuid() }) },
  responses: {
    200: jsonResponse('OK', z.object({
      data: AgentRunSchema,
      actions: z.array(AgentActionSchema),
    })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/sourcing/runs/{runId}/cancel',
  tags: ['Sourcing Agent'],
  summary: 'Cancel a running or queued run',
  security: authSecurity,
  request: { params: z.object({ runId: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', z.object({ data: AgentRunSchema })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/sourcing/runs/{runId}/findings',
  tags: ['Sourcing Agent'],
  summary: 'List findings for a run',
  security: authSecurity,
  request: {
    params: z.object({ runId: z.string().uuid() }),
    query: z.object({
      status: z.enum(['pending_review', 'approved', 'rejected', 'contacted', 'dismissed']).optional(),
      cursor: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse('OK', z.object({
      data: z.array(AgentFindingSchema),
      nextCursor: z.string().uuid().nullable(),
    })),
  },
});

// ─── Findings ──────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/sourcing/findings/{id}/approve',
  tags: ['Sourcing Agent'],
  summary: 'Approve a finding (creates a candidate when external)',
  description:
    'Recruiter override van AI-suggestie. Bij approval emit het systeem een eventBus `findingApproved` event zodat outreach (Agent XXX) kan starten.',
  security: authSecurity,
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { 'application/json': { schema: z.object({
      note: z.string().max(2000).nullable().optional(),
    }) } } },
  },
  responses: { 200: jsonResponse('OK', z.object({ data: AgentFindingSchema })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/sourcing/findings/{id}/reject',
  tags: ['Sourcing Agent'],
  summary: 'Reject a finding with reason',
  security: authSecurity,
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { 'application/json': { schema: z.object({
      reason: z.string().min(1).max(2000),
    }) } } },
  },
  responses: { 200: jsonResponse('OK', z.object({ data: AgentFindingSchema })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/sourcing/findings/bulk-approve',
  tags: ['Sourcing Agent'],
  summary: 'Bulk-approve up to 500 findings',
  security: authSecurity,
  request: {
    body: { content: { 'application/json': { schema: z.object({
      finding_ids: z.array(z.string().uuid()).min(1).max(500),
    }) } } },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: z.object({
      approved: z.number().int(),
      failed: z.number().int(),
    }) })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/sourcing/findings/bulk-reject',
  tags: ['Sourcing Agent'],
  summary: 'Bulk-reject up to 500 findings',
  security: authSecurity,
  request: {
    body: { content: { 'application/json': { schema: z.object({
      finding_ids: z.array(z.string().uuid()).min(1).max(500),
      reason: z.string().max(2000).optional(),
    }) } } },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: z.object({
      rejected: z.number().int(),
      failed: z.number().int(),
    }) })),
  },
});

// ─── Memory ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/sourcing/memory',
  tags: ['Sourcing Agent'],
  summary: 'List agent memory entries',
  security: authSecurity,
  request: {
    query: z.object({
      scope: z.enum(['tenant', 'recruiter', 'brief']).optional(),
      scope_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(AgentMemorySchema) })),
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/sourcing/memory',
  tags: ['Sourcing Agent'],
  summary: 'Upsert an agent memory entry',
  security: authSecurity,
  request: {
    body: { content: { 'application/json': { schema: z.object({
      scope: z.enum(['tenant', 'recruiter', 'brief']),
      scope_id: z.string().uuid().nullable().optional(),
      key: z.string().min(1).max(120),
      value: z.unknown(),
    }) } } },
  },
  responses: { 200: jsonResponse('OK', z.object({ data: AgentMemorySchema })) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/sourcing/memory/{id}',
  tags: ['Sourcing Agent'],
  summary: 'Delete an agent memory entry',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 204: { description: 'No Content' } },
});

// ─── Audit timeline ────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/sourcing/actions/{runId}',
  tags: ['Sourcing Agent'],
  summary: 'Get full action timeline for a run (read-only audit log)',
  description:
    'WORM trail — élke autonome AI-actie is hier zichtbaar voor compliance. UPDATE/DELETE op agent_actions worden DB-side geblokkeerd.',
  security: authSecurity,
  request: { params: z.object({ runId: z.string().uuid() }) },
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(AgentActionSchema) })),
  },
});

/**
 * AI Matching route-specs — `/api/matching/*`.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, jsonResponse } from '../common';

const MatchScore = z
  .object({
    candidate_id: z.string().uuid(),
    job_id: z.string().uuid(),
    cosine_score: z.number().min(0).max(1),
    fit_score: z.number().min(0).max(1).nullable(),
    combined_score: z.number().min(0).max(1),
    rank: z.number().int(),
    similar_hire_count: z.number().int().nullable(),
    ai_explanation: z.string().nullable(),
    ai_explanation_generated_at: z.string().datetime().nullable(),
  })
  .openapi('MatchScore');

const MatchExplanation = z
  .object({
    explanation: z.string(),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    ai_disclosure: z.string().openapi({
      example: 'Deze samenvatting is gegenereerd door AI (Claude). EU AI Act art. 14: vereist menselijke review voor hire/reject-beslissing.',
    }),
    generated_at: z.string().datetime(),
    model: z.string(),
  })
  .openapi('MatchExplanation');

registry.registerPath({
  method: 'get',
  path: '/api/matching/jobs/{jobId}',
  tags: ['AI Matching'],
  summary: 'Top matching candidates for a job',
  description:
    'Cosine + Talent Fit ranking, gepagineerd. EU AI Act: dit is "AI-assisted ranking" — geen autonome beslissing.',
  security: authSecurity,
  request: {
    params: z.object({ jobId: z.string().uuid() }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(MatchScore) })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/matching/candidates/{candidateId}',
  tags: ['AI Matching'],
  summary: 'Top matching jobs for a candidate',
  security: authSecurity,
  request: {
    params: z.object({ candidateId: z.string().uuid() }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
  },
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(MatchScore) })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/matching/jobs/{jobId}/candidates/{candidateId}/explanation',
  tags: ['AI Matching'],
  summary: 'Generate AI explanation for a match',
  description:
    'Lazy AI call. Resultaat wordt 7 dagen gecached in `match_scores.ai_explanation`. Inclusief verplichte EU AI Act disclosure-tekst.',
  security: authSecurity,
  request: {
    params: z.object({ jobId: z.string().uuid(), candidateId: z.string().uuid() }),
  },
  responses: { 200: jsonResponse('OK', MatchExplanation) },
});

// ─── Talent Fit Model ──────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/matching/talent-fit/train',
  tags: ['AI Matching'],
  summary: 'Train Talent Fit Model on tenant historical hires',
  description: 'Vereist `admin` of `owner`. Async — check `/talent-fit/model` voor status.',
  security: authSecurity,
  responses: {
    202: jsonResponse(
      'Training gestart',
      z.object({ model_id: z.string().uuid(), status: z.string() })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/matching/talent-fit/model',
  tags: ['AI Matching'],
  summary: 'Get current Talent Fit Model metadata',
  security: authSecurity,
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        trained_on: z.number().int().openapi({ description: 'aantal hires gebruikt' }),
        accuracy: z.number().nullable(),
        trained_at: z.string().datetime().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/matching/talent-fit/jobs/{jobId}/ranked',
  tags: ['AI Matching'],
  summary: 'Talent-Fit ranked candidates for a job',
  security: authSecurity,
  request: { params: z.object({ jobId: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(MatchScore) })) },
});

// ─── Similar hires ─────────────────────────────────────────────────────────

const SimilarHire = z
  .object({
    candidate_id: z.string().uuid(),
    name: z.string(),
    role: z.string().nullable(),
    similarity: z.number().min(0).max(1),
    shared_skills: z.array(z.string()),
    hired_at: z.string().datetime(),
  })
  .openapi('SimilarHire');

registry.registerPath({
  method: 'get',
  path: '/api/matching/candidates/{candidateId}/similar-hires',
  tags: ['AI Matching'],
  summary: 'Historical hires similar to candidate',
  security: authSecurity,
  request: { params: z.object({ candidateId: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(SimilarHire) })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/matching/jobs/{jobId}/similar-hires',
  tags: ['AI Matching'],
  summary: 'Historical hires similar to job profile',
  security: authSecurity,
  request: { params: z.object({ jobId: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(SimilarHire) })) },
});

// ─── Reactivation alerts ──────────────────────────────────────────────────

const ReactivationAlert = z
  .object({
    id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    job_id: z.string().uuid(),
    reason: z.string(),
    score: z.number(),
    status: z.enum(['new', 'acknowledged', 'dismissed']),
    created_at: z.string().datetime(),
  })
  .openapi('ReactivationAlert');

registry.registerPath({
  method: 'get',
  path: '/api/matching/reactivation-alerts',
  tags: ['AI Matching'],
  summary: 'List talent-reactivation alerts',
  security: authSecurity,
  request: { query: z.object({ status: z.enum(['new', 'acknowledged', 'dismissed']).optional() }) },
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(ReactivationAlert) })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/matching/reactivation-alerts/stats',
  tags: ['AI Matching'],
  summary: 'Reactivation alerts stats',
  security: authSecurity,
  responses: {
    200: jsonResponse(
      'OK',
      z.object({ new: z.number().int(), acknowledged: z.number().int(), dismissed: z.number().int() })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/matching/reactivation-alerts/{id}/acknowledge',
  tags: ['AI Matching'],
  summary: 'Acknowledge reactivation alert',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', ReactivationAlert) },
});

registry.registerPath({
  method: 'post',
  path: '/api/matching/reactivation-alerts/{id}/dismiss',
  tags: ['AI Matching'],
  summary: 'Dismiss reactivation alert',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', ReactivationAlert) },
});

/**
 * Jobs route-specs — `/api/jobs/*` (incl. JD-generator + sub-resources).
 */

import { z } from 'zod';
import { registry } from '../registry';
import {
  authSecurity,
  idParam,
  jsonResponse,
  paginationResponse,
  standardErrorResponses,
} from '../common';

const PipelineStage = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    job_id: z.string().uuid(),
    name: z.string(),
    position: z.number().int(),
    color: z.string(),
    application_count: z.number().int().optional(),
    created_at: z.string().datetime(),
  })
  .openapi('PipelineStage');

const Job = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable(),
    department: z.string().nullable(),
    location: z.string().nullable(),
    salary_min: z.number().nullable(),
    salary_max: z.number().nullable(),
    employment_type: z.enum(['fulltime', 'parttime', 'contract', 'freelance', 'internship']),
    status: z.enum(['draft', 'open', 'filled', 'closed', 'archived']),
    recruiter_id: z.string().uuid().nullable(),
    job_reference: z.string().nullable(),
    headcount: z.number().int().nullable(),
    experience_level: z.enum(['junior', 'medior', 'senior', 'lead']).nullable(),
    contract_type: z.enum(['fulltime', 'parttime', 'contract', 'temp']).nullable(),
    open_date: z.string().nullable(),
    close_date: z.string().nullable(),
    industry: z.string().nullable(),
    remote_type: z.enum(['onsite', 'hybrid', 'remote']).nullable(),
    currency: z.string().nullable(),
    salary_frequency: z.enum(['monthly', 'annual', 'hourly']).nullable(),
    required_skills: z.array(z.string()).nullable(),
    nice_to_have_skills: z.array(z.string()).nullable(),
    recruiter_name: z.string().nullable().optional(),
    stages: z.array(PipelineStage).optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    deleted_at: z.string().datetime().nullable(),
  })
  .openapi('Job');

const CreateJobInput = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().optional(),
    department: z.string().optional(),
    location: z.string().optional(),
    salary_min: z.number().optional(),
    salary_max: z.number().optional(),
    employment_type: z
      .enum(['fulltime', 'parttime', 'contract', 'freelance', 'internship'])
      .optional(),
    status: z.enum(['draft', 'open', 'filled', 'closed', 'archived']).optional(),
    recruiter_id: z.string().uuid().nullable().optional(),
    headcount: z.number().int().min(1).optional(),
    experience_level: z.enum(['junior', 'medior', 'senior', 'lead']).optional(),
    contract_type: z.enum(['fulltime', 'parttime', 'contract', 'temp']).optional(),
    open_date: z.string().optional(),
    close_date: z.string().optional(),
    industry: z.string().optional(),
    remote_type: z.enum(['onsite', 'hybrid', 'remote']).optional(),
    currency: z.string().optional(),
    salary_frequency: z.enum(['monthly', 'annual', 'hourly']).optional(),
    required_skills: z.array(z.string()).optional(),
    nice_to_have_skills: z.array(z.string()).optional(),
    pipeline_template_id: z.string().uuid().optional(),
  })
  .openapi('CreateJobInput');

const UpdateJobInput = CreateJobInput.partial().openapi('UpdateJobInput');

const JobsListResponse = z
  .object({
    data: z.array(Job),
    pagination: paginationResponse,
  })
  .openapi('JobsListResponse');

// ─── Routes ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/jobs',
  tags: ['Jobs'],
  summary: 'List jobs',
  security: authSecurity,
  request: {
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      status: z.enum(['draft', 'open', 'filled', 'closed', 'archived']).optional(),
      search: z.string().optional(),
      recruiter_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: jsonResponse('OK', JobsListResponse),
    401: standardErrorResponses[401],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/jobs',
  tags: ['Jobs'],
  summary: 'Create job',
  description:
    'Maakt job + cloont pipeline-template stages. Bij `status="open"` wordt EU Pay Transparency gevalideerd (salary_min, salary_max en currency vereist).',
  security: authSecurity,
  request: { body: { content: { 'application/json': { schema: CreateJobInput } } } },
  responses: {
    201: jsonResponse('Aangemaakt', Job),
    400: standardErrorResponses[400],
    422: jsonResponse('Pay Transparency-vereisten ontbreken', z.object({})),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/jobs/{id}',
  tags: ['Jobs'],
  summary: 'Get job',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', Job), 404: standardErrorResponses[404] },
});

registry.registerPath({
  method: 'patch',
  path: '/api/jobs/{id}',
  tags: ['Jobs'],
  summary: 'Update job',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: UpdateJobInput } } },
  },
  responses: { 200: jsonResponse('OK', Job) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/jobs/{id}',
  tags: ['Jobs'],
  summary: 'Soft-delete job',
  security: authSecurity,
  request: { params: idParam },
  responses: { 204: { description: 'Verwijderd' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/jobs/{id}/duplicate',
  tags: ['Jobs'],
  summary: 'Duplicate job',
  security: authSecurity,
  request: { params: idParam },
  responses: { 201: jsonResponse('Aangemaakt', Job) },
});

registry.registerPath({
  method: 'get',
  path: '/api/jobs/{id}/stats',
  tags: ['Jobs'],
  summary: 'Job stats (pipeline counts, time-to-hire)',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        applications_total: z.number().int(),
        applications_per_stage: z.record(z.number().int()),
        days_open: z.number().int(),
        avg_time_in_stage_days: z.number().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/jobs/{id}/funnel',
  tags: ['Jobs'],
  summary: 'Pipeline funnel — drop-off per stage',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ stages: z.array(z.unknown()) })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/jobs/{id}/health',
  tags: ['Jobs'],
  summary: 'Job health score',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        score: z.number().int().min(0).max(100),
        signals: z.array(z.object({ key: z.string(), severity: z.string(), message: z.string() })),
      })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/jobs/{id}/sourcing-suggestions',
  tags: ['Jobs'],
  summary: 'Boolean-search sourcing suggestions',
  description:
    'Genereert 3-5 deterministische boolean-search-strings (LinkedIn/GitHub X-ray) uit job title + required_skills + nice_to_have_skills. Geen AI — zelfde input geeft zelfde output.',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse('OK', z.object({ data: z.array(z.string()) })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/jobs/{id}/bias-check',
  tags: ['Jobs'],
  summary: 'Bias check on job description (AI)',
  description:
    'Detecteert biased wording in job-description (gendered language, age signals, ableist phrasing). EU AI Act: high-risk; resultaten worden in `ai_events` gelogd.',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        bias_detected: z.boolean(),
        suggestions: z.array(z.object({ text: z.string(), reason: z.string() })),
      })
    ),
  },
});

// ─── JD generator ──────────────────────────────────────────────────────────

const JdDraft = z
  .object({
    id: z.string().uuid(),
    job_id: z.string().uuid().nullable(),
    title_seed: z.string(),
    variants: z.array(
      z.object({ id: z.string(), tone: z.string(), title: z.string(), description: z.string() })
    ),
    selected_variant_id: z.string().nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('JdDraft');

registry.registerPath({
  method: 'post',
  path: '/api/jobs/jd-drafts',
  tags: ['Jobs'],
  summary: 'Generate AI job-description drafts',
  description: 'Genereert 3 varianten (formal/casual/inclusive). EU AI Act-disclosure wordt meegestuurd.',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            title: z.string().min(1).max(300),
            seniority: z.string().optional(),
            company_voice: z.string().optional(),
            language: z.enum(['nl', 'en', 'de', 'fr']).default('nl'),
          }),
        },
      },
    },
  },
  responses: { 201: jsonResponse('Aangemaakt', JdDraft) },
});

registry.registerPath({
  method: 'get',
  path: '/api/jobs/jd-drafts',
  tags: ['Jobs'],
  summary: 'List JD drafts',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(JdDraft) })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/jobs/jd-drafts/{id}/publish',
  tags: ['Jobs'],
  summary: 'Publish JD draft → create job',
  security: authSecurity,
  request: { params: idParam },
  responses: { 201: jsonResponse('Aangemaakt', Job) },
});

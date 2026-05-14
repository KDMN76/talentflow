/**
 * Candidates route-specs — `/api/candidates/*`.
 *
 * Sluit aan op `apps/api/src/modules/candidates/candidates.schema.ts` en
 * `packages/shared/src/types/candidate.ts`.
 */

import { z } from 'zod';
import { registry } from '../registry';
import {
  ErrorResponse,
  authSecurity,
  idParam,
  jsonResponse,
  paginationResponse,
  standardErrorResponses,
} from '../common';

// ─── Schemas ────────────────────────────────────────────────────────────────

const CandidateSkill = z
  .object({
    id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    skill: z.string(),
    score: z.number().int().min(1).max(10).nullable(),
    source: z.enum(['manual', 'ai_extracted']).nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('CandidateSkill');

const CandidateResume = z
  .object({
    id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    filename: z.string(),
    storage_url: z.string().nullable(),
    mime_type: z.string().nullable(),
    size_bytes: z.number().int().nullable(),
    is_primary: z.boolean(),
    parsed_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
    storage_key: z.string().nullable(),
    ai_summary: z.string().nullable(),
    parse_status: z.enum(['pending', 'processing', 'done', 'failed']),
    parse_error: z.string().nullable(),
  })
  .openapi('CandidateResume');

const Candidate = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    candidate_reference: z.string().nullable(),
    name: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    email: z.string().email().nullable(),
    phone: z.string().nullable(),
    gender: z.enum(['male', 'female', 'other', 'prefer_not']).nullable(),
    birthdate: z.string().nullable(),
    nationalities: z.array(z.string()).nullable(),
    languages: z.array(z.string()).nullable(),
    notice_period: z.string().nullable(),
    current_salary: z.number().nullable(),
    current_salary_currency: z.string().nullable(),
    expected_salary: z.number().nullable(),
    expected_salary_currency: z.string().nullable(),
    years_of_experience: z.number().int().nullable(),
    current_position: z.string().nullable(),
    current_company: z.string().nullable(),
    industry: z.string().nullable(),
    diploma: z.string().nullable(),
    university: z.string().nullable(),
    address_city: z.string().nullable(),
    address_country: z.string().nullable(),
    description: z.string().nullable(),
    source: z.string().nullable(),
    gdpr_consent: z.boolean(),
    gdpr_consent_at: z.string().datetime().nullable(),
    email_consent: z.boolean(),
    email_consent_at: z.string().datetime().nullable(),
    skills: z.array(z.string()).nullable(),
    tags: z.array(z.string()).nullable(),
    notes: z.string().nullable(),
    ai_score: z.number().int().min(0).max(100).nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    deleted_at: z.string().datetime().nullable(),
    candidate_skills: z.array(CandidateSkill).optional(),
    resumes: z.array(CandidateResume).optional(),
  })
  .openapi('Candidate');

const CreateCandidateInput = z
  .object({
    name: z.string().min(1).max(200).optional(),
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(50).optional(),
    candidate_reference: z.string().regex(/^[A-Z0-9]+$/).min(8).max(12).optional(),
    gender: z.enum(['male', 'female', 'other', 'prefer_not']).optional(),
    birthdate: z.string().optional(),
    nationalities: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    notice_period: z.string().optional(),
    current_salary: z.number().nonnegative().optional(),
    current_salary_currency: z.string().max(8).optional(),
    expected_salary: z.number().nonnegative().optional(),
    expected_salary_currency: z.string().max(8).optional(),
    years_of_experience: z.number().int().min(0).max(80).optional(),
    current_department: z.string().optional(),
    industry: z.string().optional(),
    diploma: z.string().optional(),
    university: z.string().optional(),
    address_line1: z.string().optional(),
    address_line2: z.string().optional(),
    address_city: z.string().optional(),
    address_country: z.string().optional(),
    address_postal_code: z.string().optional(),
    description: z.string().max(20000).optional(),
    source: z.string().max(100).optional(),
    gdpr_consent: z.boolean().optional(),
    email_consent: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    notes: z.string().optional(),
    skills: z.array(z.string()).optional(),
  })
  .openapi('CreateCandidateInput');

const UpdateCandidateInput = CreateCandidateInput.partial().openapi('UpdateCandidateInput');

const CreateCandidateSkillInput = z
  .object({
    skill: z.string().min(1).max(120),
    score: z.number().int().min(1).max(10).optional(),
    source: z.enum(['manual', 'ai_extracted']).optional(),
  })
  .openapi('CreateCandidateSkillInput');

const CandidatesListResponse = z
  .object({
    data: z.array(Candidate),
    pagination: paginationResponse,
  })
  .openapi('CandidatesListResponse');

const BulkAction = z
  .object({
    action: z.enum(['tag', 'untag', 'delete', 'add_to_pipeline', 'export']),
    candidate_ids: z.array(z.string().uuid()).min(1).max(5000),
    payload: z.record(z.unknown()).optional(),
  })
  .openapi('BulkAction');

// ─── Routes ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/candidates',
  tags: ['Candidates'],
  summary: 'List candidates',
  description:
    'Pagineerde lijst kandidaten met filters voor zoektekst, skills, tags en source. Ondersteunt boolean-search syntax in `search`.',
  security: authSecurity,
  request: {
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().optional().openapi({ example: 'react AND senior' }),
      skills: z.string().optional().openapi({ description: 'Comma-separated' }),
      tags: z.string().optional().openapi({ description: 'Comma-separated' }),
      source: z.string().optional(),
    }),
  },
  responses: {
    200: jsonResponse('OK', CandidatesListResponse),
    401: standardErrorResponses[401],
    429: standardErrorResponses[429],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/candidates',
  tags: ['Candidates'],
  summary: 'Create candidate',
  description: 'Maakt een nieuwe kandidaat aan. Minimaal `name` of `first_name`+`last_name` is verplicht.',
  security: authSecurity,
  request: {
    body: { content: { 'application/json': { schema: CreateCandidateInput } } },
  },
  responses: {
    201: jsonResponse('Aangemaakt', Candidate),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    409: jsonResponse('Duplicate (email of candidate_reference)', ErrorResponse),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/candidates/{id}',
  tags: ['Candidates'],
  summary: 'Get candidate by id',
  description: 'Hydrateert candidate_skills + resumes.',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse('OK', Candidate),
    401: standardErrorResponses[401],
    404: standardErrorResponses[404],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/candidates/{id}',
  tags: ['Candidates'],
  summary: 'Update candidate',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: UpdateCandidateInput } } },
  },
  responses: {
    200: jsonResponse('OK', Candidate),
    400: standardErrorResponses[400],
    404: standardErrorResponses[404],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/candidates/{id}',
  tags: ['Candidates'],
  summary: 'Soft-delete candidate',
  description: 'Zet `deleted_at`. Voor harde delete: gebruik `/api/compliance/dsar-requests`.',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    204: { description: 'Verwijderd' },
    404: standardErrorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/candidates/{id}/skills',
  tags: ['Candidates'],
  summary: 'List candidate skills',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.array(CandidateSkill)) },
});

registry.registerPath({
  method: 'post',
  path: '/api/candidates/{id}/skills',
  tags: ['Candidates'],
  summary: 'Add candidate skill',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: CreateCandidateSkillInput } } },
  },
  responses: {
    201: jsonResponse('Aangemaakt', CandidateSkill),
    400: standardErrorResponses[400],
    404: standardErrorResponses[404],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/candidates/{id}/skills/{skillId}',
  tags: ['Candidates'],
  summary: 'Remove candidate skill',
  security: authSecurity,
  request: {
    params: z.object({ id: z.string().uuid(), skillId: z.string().uuid() }),
  },
  responses: { 204: { description: 'Verwijderd' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/candidates/{id}/resumes',
  tags: ['Candidates'],
  summary: 'List candidate resumes',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.array(CandidateResume)) },
});

registry.registerPath({
  method: 'post',
  path: '/api/candidates/{id}/resumes',
  tags: ['Candidates'],
  summary: 'Upload one or more resumes',
  description:
    'Multipart `files[]` — max 5 bestanden, 10MB elk. Toegestane MIME: PDF, DOC, DOCX. Parsing gebeurt async; check `parse_status`.',
  security: authSecurity,
  request: {
    params: idParam,
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            files: z.array(z.string().openapi({ format: 'binary' })),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse('Geüpload', z.array(CandidateResume)),
    400: standardErrorResponses[400],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/candidates/{id}/resumes/{resumeId}',
  tags: ['Candidates'],
  summary: 'Delete resume',
  security: authSecurity,
  request: {
    params: z.object({ id: z.string().uuid(), resumeId: z.string().uuid() }),
  },
  responses: { 204: { description: 'Verwijderd' } },
});

registry.registerPath({
  method: 'patch',
  path: '/api/candidates/{id}/resumes/{resumeId}/primary',
  tags: ['Candidates'],
  summary: 'Mark resume as primary',
  security: authSecurity,
  request: {
    params: z.object({ id: z.string().uuid(), resumeId: z.string().uuid() }),
  },
  responses: { 200: jsonResponse('OK', CandidateResume) },
});

registry.registerPath({
  method: 'get',
  path: '/api/candidates/{id}/timeline',
  tags: ['Candidates'],
  summary: 'Candidate activity timeline',
  description:
    'Chronologische combinatie van applications, communications, scorecards, audit-events.',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(
          z.object({
            type: z.string(),
            occurred_at: z.string().datetime(),
            actor: z.string().nullable(),
            description: z.string(),
            metadata: z.record(z.unknown()).optional(),
          })
        ),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/candidates/bulk-actions',
  tags: ['Candidates'],
  summary: 'Bulk actions (tag, delete, export, …)',
  security: authSecurity,
  request: {
    body: { content: { 'application/json': { schema: BulkAction } } },
  },
  responses: {
    200: jsonResponse(
      'Resultaat',
      z.object({ processed: z.number().int(), failed: z.number().int() })
    ),
    400: standardErrorResponses[400],
  },
});

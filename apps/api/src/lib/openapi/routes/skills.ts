/**
 * Skills route-specs — `/api/skills/*` + skill-profile/gap op candidates+jobs.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, jsonResponse } from '../common';

const EscoSkill = z
  .object({
    esco_uri: z.string().url(),
    label: z.string(),
    alt_labels: z.array(z.string()),
    description: z.string().nullable(),
    skill_type: z.enum(['skill', 'knowledge', 'attitude']).nullable(),
  })
  .openapi('EscoSkill');

const SkillProfile = z
  .object({
    entity_id: z.string().uuid(),
    entity_type: z.enum(['candidate', 'job']),
    skills: z.array(
      z.object({
        esco_uri: z.string().url().nullable(),
        label: z.string(),
        score: z.number().min(0).max(1).nullable(),
        source: z.enum(['manual', 'ai_extracted', 'esco_synced']),
      })
    ),
    last_synced_at: z.string().datetime().nullable(),
  })
  .openapi('SkillProfile');

const SkillsGap = z
  .object({
    matched: z.array(z.object({ label: z.string(), candidate_score: z.number().nullable() })),
    missing: z.array(z.object({ label: z.string(), required: z.boolean() })),
    coverage: z.number().min(0).max(1),
  })
  .openapi('SkillsGap');

registry.registerPath({
  method: 'get',
  path: '/api/skills/esco',
  tags: ['Skills'],
  summary: 'Search ESCO taxonomy',
  security: authSecurity,
  request: { query: z.object({ q: z.string().min(1), limit: z.coerce.number().int().max(50).default(10) }) },
  responses: { 200: jsonResponse('OK', z.array(EscoSkill)) },
});

registry.registerPath({
  method: 'get',
  path: '/api/skills/trending',
  tags: ['Skills'],
  summary: 'Trending skills binnen tenant',
  security: authSecurity,
  responses: {
    200: jsonResponse(
      'OK',
      z.array(z.object({ label: z.string(), count_30d: z.number().int(), delta_pct: z.number() }))
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/skills/demand-supply',
  tags: ['Skills'],
  summary: 'Skill demand vs candidate-supply',
  security: authSecurity,
  responses: {
    200: jsonResponse(
      'OK',
      z.array(
        z.object({
          label: z.string(),
          demand: z.number().int(),
          supply: z.number().int(),
          ratio: z.number(),
        })
      )
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/candidates/{id}/skill-profile',
  tags: ['Skills', 'Candidates'],
  summary: 'Get candidate skill profile',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', SkillProfile) },
});

registry.registerPath({
  method: 'post',
  path: '/api/candidates/{id}/sync-esco',
  tags: ['Skills', 'Candidates'],
  summary: 'Sync candidate skills naar ESCO-taxonomie (AI)',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', SkillProfile) },
});

registry.registerPath({
  method: 'get',
  path: '/api/jobs/{id}/skill-profile',
  tags: ['Skills', 'Jobs'],
  summary: 'Get job skill profile',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', SkillProfile) },
});

registry.registerPath({
  method: 'post',
  path: '/api/jobs/{id}/sync-esco',
  tags: ['Skills', 'Jobs'],
  summary: 'Sync job skills naar ESCO',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', SkillProfile) },
});

registry.registerPath({
  method: 'get',
  path: '/api/jobs/{id}/candidates/{cid}/skills-gap',
  tags: ['Skills'],
  summary: 'Skills gap analysis between job and candidate',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid(), cid: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', SkillsGap) },
});

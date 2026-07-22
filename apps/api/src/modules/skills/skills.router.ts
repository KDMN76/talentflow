/**
 * Skills routers — Sprint Q3.6 (Agent HHH).
 *
 * Drie routers, omdat het skill-domein over /api/skills, /api/candidates en
 * /api/jobs verspreid is:
 *
 *   - skillsRouter            → mount op /api/skills
 *       GET  /esco
 *       GET  /trending
 *       GET  /demand-supply
 *
 *   - candidatesSkillsRouter  → mount op /api/candidates
 *       GET   /:id/skill-profile
 *       PATCH /:id/skill-profile
 *       POST  /:id/sync-esco
 *
 *   - jobsSkillsRouter        → mount op /api/jobs
 *       GET  /:id/skill-profile
 *       POST /:id/sync-esco
 *       GET  /:id/candidates/:cid/skills-gap
 */

import { Router } from 'express';
import * as controller from './skills.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

// ─── /api/skills ──────────────────────────────────────────────────────────
export const skillsRouter = Router();
skillsRouter.use(requireAuth, tenantMiddleware);

skillsRouter.get('/esco', controller.searchEsco);
skillsRouter.get('/trending', controller.getTrending);
skillsRouter.get('/demand-supply', controller.getDemandSupply);

// ─── /api/candidates/:id/skill-profile + /sync-esco ───────────────────────
export const candidatesSkillsRouter = Router({ mergeParams: true });
candidatesSkillsRouter.use(requireAuth, tenantMiddleware);

candidatesSkillsRouter.get('/:id/skill-profile', controller.getCandidateProfile);
candidatesSkillsRouter.patch('/:id/skill-profile', requirePermission('candidates', 'write'), controller.updateCandidateProfile);
candidatesSkillsRouter.post('/:id/sync-esco', requirePermission('candidates', 'write'), controller.syncCandidateEsco);

// ─── /api/jobs/:id/skill-profile + /sync-esco + skills-gap ────────────────
export const jobsSkillsRouter = Router({ mergeParams: true });
jobsSkillsRouter.use(requireAuth, tenantMiddleware);

jobsSkillsRouter.get('/:id/skill-profile', controller.getJobProfile);
jobsSkillsRouter.post('/:id/sync-esco', requirePermission('jobs', 'write'), controller.syncJobEsco);
jobsSkillsRouter.get(
  '/:id/candidates/:cid/skills-gap',
  controller.getSkillsGap
);

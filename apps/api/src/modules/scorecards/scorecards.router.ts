/**
 * Scorecards routes are mounted in three places:
 *   - GET/POST /api/applications/:id/scorecards   (application-scoped)
 *   - GET/POST /api/scorecards/templates          (template CRUD)
 *   - GET/DELETE /api/scorecards/:id              (single scorecard)
 *
 * Because Express routers are tree-mounted, this file exports two routers:
 *   `applicationsScorecardsRouter` — for use under /applications
 *   `scorecardsRouter`             — for use under /scorecards
 */

import { Router } from 'express';
import * as controller from './scorecards.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requireWriteOnMutation } from '../../middleware/permissions';

// Scorecards zijn interview-feedback → gemapt op de `interviews`-resource:
// recruiter/hiring_manager (interviews:write) mogen indienen, read-only rollen
// zoals `viewer` niet.

// Application-scoped routes — caller mounts at /api/applications
export const applicationsScorecardsRouter = Router({ mergeParams: true });
applicationsScorecardsRouter.use(requireAuth, tenantMiddleware);
applicationsScorecardsRouter.use(requireWriteOnMutation('interviews'));
applicationsScorecardsRouter.get('/:id/scorecards', controller.listForApplication);
applicationsScorecardsRouter.post('/:id/scorecards', controller.createForApplication);

// Standalone scorecards + templates router — caller mounts at /api/scorecards
export const scorecardsRouter = Router();
scorecardsRouter.use(requireAuth, tenantMiddleware);
scorecardsRouter.use(requireWriteOnMutation('interviews'));

// Templates first so /templates isn't captured as :id
scorecardsRouter.get('/templates', controller.listTemplates);
scorecardsRouter.post('/templates', controller.createTemplate);
scorecardsRouter.get('/templates/:id', controller.getTemplateOne);

scorecardsRouter.get('/:id', controller.getOne);
scorecardsRouter.delete('/:id', controller.remove);

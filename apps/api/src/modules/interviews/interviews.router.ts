/**
 * Interview routes — mounted in three places:
 *   - /api/interviews                   (list/create/get/patch/delete)
 *   - /api/interviews/availability/...  (slots + per-user hours/overrides)
 *   - /api/interview-kits               (kits CRUD — separate router)
 *   - /api/applications/:id/agreement-matrix (mounted op applicationsScorecardsRouter style)
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import * as ctrl from './interviews.controller';

// /api/interviews
export const interviewsRouter = Router();
interviewsRouter.use(requireAuth, tenantMiddleware);

// ── Availability — moeten VÓÓR /:id staan zodat 'availability' niet als
// id wordt herkend.
interviewsRouter.post('/availability/slots', ctrl.getSlots);
interviewsRouter.get('/availability/:userId', ctrl.getUserAvailability);
interviewsRouter.put('/availability/:userId', ctrl.putRecurringHours);
interviewsRouter.post('/availability/:userId/override', ctrl.postOverride);

// ── Interviews CRUD
interviewsRouter.get('/', ctrl.listInterviews);
interviewsRouter.post('/', ctrl.createInterview);
interviewsRouter.get('/:id', ctrl.getInterview);
interviewsRouter.patch('/:id', ctrl.patchInterview);
interviewsRouter.delete('/:id', ctrl.deleteInterview);

// /api/interview-kits
export const interviewKitsRouter = Router();
interviewKitsRouter.use(requireAuth, tenantMiddleware);
interviewKitsRouter.get('/', ctrl.listKits);
interviewKitsRouter.post('/', ctrl.createKit);
interviewKitsRouter.get('/:id', ctrl.getKit);
interviewKitsRouter.patch('/:id', ctrl.patchKit);
interviewKitsRouter.delete('/:id', ctrl.deleteKit);

// /api/applications/:id/agreement-matrix — deze router moet onder
// /api/applications gemount worden zodat hij naast applicationsScorecardsRouter
// kan leven.
export const applicationsAgreementMatrixRouter = Router({ mergeParams: true });
applicationsAgreementMatrixRouter.use(requireAuth, tenantMiddleware);
applicationsAgreementMatrixRouter.get(
  '/:id/agreement-matrix',
  ctrl.getAgreementMatrixForApp
);

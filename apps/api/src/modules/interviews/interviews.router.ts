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
import {
  requirePermission,
  requireWriteOnMutation,
} from '../../middleware/permissions';
import * as ctrl from './interviews.controller';

// Muterende interview-acties vereisen interviews:write (recruiter/
// hiring_manager). `viewer` en andere read-only rollen worden geblokkeerd.
// LET OP: POST /availability/slots is een read-via-POST (query) en blijft
// bewust ongeguard, daarom hier per-route i.p.v. een router-brede gate.
const canWriteInterviews = requirePermission('interviews', 'write');

// /api/interviews
export const interviewsRouter = Router();
interviewsRouter.use(requireAuth, tenantMiddleware);

// ── Availability — moeten VÓÓR /:id staan zodat 'availability' niet als
// id wordt herkend.
interviewsRouter.post('/availability/slots', ctrl.getSlots); // read-via-POST
interviewsRouter.get('/availability/:userId', ctrl.getUserAvailability);
interviewsRouter.put('/availability/:userId', canWriteInterviews, ctrl.putRecurringHours);
interviewsRouter.post('/availability/:userId/override', canWriteInterviews, ctrl.postOverride);

// ── Interviews CRUD
interviewsRouter.get('/', ctrl.listInterviews);
interviewsRouter.post('/', canWriteInterviews, ctrl.createInterview);
interviewsRouter.get('/:id', ctrl.getInterview);
interviewsRouter.patch('/:id', canWriteInterviews, ctrl.patchInterview);
interviewsRouter.delete('/:id', canWriteInterviews, ctrl.deleteInterview);

// /api/interview-kits
export const interviewKitsRouter = Router();
interviewKitsRouter.use(requireAuth, tenantMiddleware);
interviewKitsRouter.use(requireWriteOnMutation('interviews'));
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

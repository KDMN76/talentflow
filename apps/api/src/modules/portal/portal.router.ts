import { Router } from 'express';
import * as portalController from './portal.controller';
import * as portalAdminController from './portal-admin.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { portalPublicRateLimit } from '../../middleware/rateLimit';

// ─────────────────────────────────────────────────────────────────────────────
// Public router — token-based access, NO auth middleware.
// Mounted FIRST so the auth-protected routes below cannot match these paths.
// Alle publieke routes zitten achter een eigen (strengere) rate-limiter
// bovenop de globale /api-limiter: bescherming tegen token-brute-force en
// feedback-spam.
// ─────────────────────────────────────────────────────────────────────────────
const publicRouter = Router();
publicRouter.use(portalPublicRateLimit);
publicRouter.get('/access/:token', portalController.getAccess);
publicRouter.post('/access/:token/feedback', portalController.submitFeedback);
publicRouter.post(
  '/access/:token/log-view/:candidateId',
  portalController.logCandidateView
);
publicRouter.get('/branding/:token', portalController.getBranding);

// ─────────────────────────────────────────────────────────────────────────────
// Admin router — requires JWT + tenant context
// ─────────────────────────────────────────────────────────────────────────────
const adminRouter = Router();
adminRouter.use(requireAuth, tenantMiddleware);

adminRouter.get('/', portalController.listForTenant);
adminRouter.post('/', portalController.create);
adminRouter.get('/by-job/:jobId', portalController.listForJob);
// Specifieke sub-routes vóór de generieke /:id-routes registreren.
adminRouter.get('/:id/feedback', portalController.listFeedback);
adminRouter.get('/:id/activity', portalAdminController.getActivity);
adminRouter.post('/:id/rotate-token', portalAdminController.rotateToken);
adminRouter.post('/:id/verify-domain', portalAdminController.verifyDomain);
adminRouter.get('/:id', portalController.getOne);
adminRouter.patch('/:id', portalAdminController.patchPortalLink);
adminRouter.delete('/:id', portalController.remove);

// ─────────────────────────────────────────────────────────────────────────────
// Combined router — public routes registered first, then admin routes.
// Order matters: an Express Router walks its stack in declaration order, so
// the un-authenticated /access/* paths are matched before the admin router's
// requireAuth middleware ever runs.
// ─────────────────────────────────────────────────────────────────────────────
const router = Router();
router.use(publicRouter);
router.use(adminRouter);

export default router;

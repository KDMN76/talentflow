import { Router } from 'express';
import * as portalController from './portal.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

// ─────────────────────────────────────────────────────────────────────────────
// Public router — token-based access, NO auth middleware.
// Mounted FIRST so the auth-protected routes below cannot match these paths.
// ─────────────────────────────────────────────────────────────────────────────
const publicRouter = Router();
publicRouter.get('/access/:token', portalController.getAccess);
publicRouter.post('/access/:token/feedback', portalController.submitFeedback);

// ─────────────────────────────────────────────────────────────────────────────
// Admin router — requires JWT + tenant context
// ─────────────────────────────────────────────────────────────────────────────
const adminRouter = Router();
adminRouter.use(requireAuth, tenantMiddleware);

adminRouter.get('/', portalController.listForTenant);
adminRouter.post('/', portalController.create);
adminRouter.get('/by-job/:jobId', portalController.listForJob);
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

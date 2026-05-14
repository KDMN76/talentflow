import { Router } from 'express';
import * as careerPagesController from './career-pages.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

// ─── Public routes (no auth) ──────────────────────────────────────────────────
// Mounted before the auth middleware so they remain accessible without a token.
router.get('/public/:slug', careerPagesController.getPublic);
router.post('/public/:slug/apply', careerPagesController.submitApplication);

// ─── Admin routes (auth + tenant) ─────────────────────────────────────────────
router.get('/', requireAuth, tenantMiddleware, careerPagesController.list);
router.post('/', requireAuth, tenantMiddleware, careerPagesController.create);
router.get('/:id', requireAuth, tenantMiddleware, careerPagesController.get);
router.patch('/:id', requireAuth, tenantMiddleware, careerPagesController.update);
router.delete('/:id', requireAuth, tenantMiddleware, careerPagesController.remove);

export default router;

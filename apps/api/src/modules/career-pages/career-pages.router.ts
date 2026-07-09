import { Router } from 'express';
import * as careerPagesController from './career-pages.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

// ─── Public routes (no auth) ──────────────────────────────────────────────────
// Mounted before the auth middleware so they remain accessible without a token.
// LET OP: resolve-domain MOET vóór /public/:slug staan, anders vangt de
// :slug-parameter het pad "resolve-domain" af.
router.get('/public/resolve-domain', careerPagesController.resolveDomain);
router.get('/public/:slug', careerPagesController.getPublic);
router.post('/public/:slug/apply', careerPagesController.submitApplication);

// ─── Admin routes (auth + tenant) ─────────────────────────────────────────────
router.get('/', requireAuth, tenantMiddleware, careerPagesController.list);
router.post('/', requireAuth, tenantMiddleware, careerPagesController.create);
router.get('/:id', requireAuth, tenantMiddleware, careerPagesController.get);
router.patch('/:id', requireAuth, tenantMiddleware, careerPagesController.update);
router.delete('/:id', requireAuth, tenantMiddleware, careerPagesController.remove);

// Custom-domain (white-label serving): koppelen/wissen + DNS-verificatie.
router.put(
  '/:id/custom-domain',
  requireAuth,
  tenantMiddleware,
  careerPagesController.setCustomDomain
);
router.post(
  '/:id/custom-domain/verify',
  requireAuth,
  tenantMiddleware,
  careerPagesController.verifyCustomDomain
);

// Builder: blocks opslaan + publiceren/depubliceren.
router.patch('/:id/blocks', requireAuth, tenantMiddleware, careerPagesController.updateBlocks);
router.post('/:id/publish', requireAuth, tenantMiddleware, careerPagesController.publish);
router.post('/:id/unpublish', requireAuth, tenantMiddleware, careerPagesController.unpublish);

export default router;

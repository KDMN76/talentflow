import { Router } from 'express';
import * as tenantsController from './tenants.controller';
import * as brandingController from './branding.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requireRole } from '../../middleware/auth';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/current', tenantsController.getCurrentTenant);
router.patch('/current', requireRole('admin', 'super_admin'), tenantsController.updateCurrentTenant);

// ── White-label branding (Sprint Q2.1) ───────────────────────────────────────
router.get('/branding', brandingController.getBranding);
router.put(
  '/branding',
  requireRole('admin', 'super_admin'),
  brandingController.putBranding
);

export default router;

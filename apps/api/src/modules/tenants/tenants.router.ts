import { Router } from 'express';
import * as tenantsController from './tenants.controller';
import * as brandingController from './branding.controller';
import * as emailSettingsController from './emailSettings.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requireRole } from '../../middleware/auth';
import { emailTestRateLimit } from '../../middleware/rateLimit';

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

// ── E-mailinstellingen (afzendernaam / Reply-To / eigen SMTP — migration 042) ─
// Admin-only, ook de GET: de instellingen bevatten SMTP-host/user-details.
router.get(
  '/email-settings',
  requireRole('admin', 'super_admin'),
  emailSettingsController.getEmailSettings
);
router.put(
  '/email-settings',
  requireRole('admin', 'super_admin'),
  emailSettingsController.putEmailSettings
);
router.post(
  '/email-settings/test',
  requireRole('admin', 'super_admin'),
  emailTestRateLimit,
  emailSettingsController.sendTestEmail
);

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import * as tenantsController from './tenants.controller';
import * as brandingController from './branding.controller';
import * as emailSettingsController from './emailSettings.controller';
import * as moduleFlagsController from './moduleFlags.controller';
import { MAX_LOGO_BYTES } from './brandingLogo.service';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requireRole } from '../../middleware/auth';
import { emailTestRateLimit } from '../../middleware/rateLimit';
import { AppError } from '../../middleware/errorHandler';

// Logo-upload: memory-storage (buffer gaat direct naar de FileStorage-
// abstractie), hard cap op bestandsgrootte. Mime/inhoud-validatie zit in
// brandingLogo.service.ts (magic bytes + SVG-scrub).
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES },
});

/** Vertaalt multer-fouten (o.a. LIMIT_FILE_SIZE) naar nette AppErrors. */
function handleLogoUpload(req: Request, res: Response, next: NextFunction): void {
  logoUpload.single('logo')(req, res, (err: unknown) => {
    if (err) {
      if ((err as multer.MulterError).code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            400,
            'LOGO_TOO_LARGE',
            `Logo is te groot (max ${Math.floor(MAX_LOGO_BYTES / 1024)} kB).`
          )
        );
      }
      return next(new AppError(400, 'UPLOAD_ERROR', 'Upload mislukt. Probeer het opnieuw.'));
    }
    next();
  });
}

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/current', tenantsController.getCurrentTenant);
router.patch('/current', requireRole('admin', 'super_admin', 'owner'), tenantsController.updateCurrentTenant);

// ── Module-zichtbaarheid (migration 050) ─────────────────────────────────────
// GET voor elke user (sidebar-filtering); PUT admin-only met audit-event.
router.get('/modules', moduleFlagsController.getModules);
router.put(
  '/modules',
  requireRole('admin', 'super_admin', 'owner'),
  moduleFlagsController.putModules
);

// ── White-label branding (Sprint Q2.1) ───────────────────────────────────────
router.get('/branding', brandingController.getBranding);
router.put(
  '/branding',
  requireRole('admin', 'super_admin', 'owner'),
  brandingController.putBranding
);

// Logo-upload via de bestaande storage-infra (MinIO/S3 of local disk) —
// migration 045. Serveren gebeurt publiek via /api/public/branding/:tenantId/logo
// (brandingPublic.router.ts, gemount in index.ts).
router.post(
  '/branding/logo',
  requireRole('admin', 'super_admin', 'owner'),
  handleLogoUpload,
  brandingController.postBrandingLogo
);
router.delete(
  '/branding/logo',
  requireRole('admin', 'super_admin', 'owner'),
  brandingController.deleteBrandingLogo
);

// ── E-mailinstellingen (afzendernaam / Reply-To / eigen SMTP — migration 042) ─
// Admin-only, ook de GET: de instellingen bevatten SMTP-host/user-details.
router.get(
  '/email-settings',
  requireRole('admin', 'super_admin', 'owner'),
  emailSettingsController.getEmailSettings
);
router.put(
  '/email-settings',
  requireRole('admin', 'super_admin', 'owner'),
  emailSettingsController.putEmailSettings
);
router.post(
  '/email-settings/test',
  requireRole('admin', 'super_admin', 'owner'),
  emailTestRateLimit,
  emailSettingsController.sendTestEmail
);

export default router;

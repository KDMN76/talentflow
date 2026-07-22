/**
 * Candidate compliance-routes — Sprint Q2.3.
 *
 * Mount-pad: `/api/candidates`. Deze routes worden NA de bestaande
 * candidates.router gemount; we registreren alleen de extra paden:
 *   - POST /:id/anonymize
 *   - POST /:id/self-service-token
 *   - POST /:id/retention-exclude
 *   - GET  /:id/resumes/:resumeId/anonymized   (download)
 *
 * Reden voor een aparte router: de candidates.router is van Agent BB en
 * mag deze sprint niet aangeraakt worden behalve voor mounting.
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import * as complianceController from './compliance.controller';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.post(
  '/:id/anonymize',
  requireRole('admin', 'owner'),
  complianceController.anonymizeCandidateHandler
);

router.post(
  '/:id/self-service-token',
  requireRole('admin', 'owner'),
  complianceController.generateSelfServiceTokenHandler
);

router.post(
  '/:id/retention-exclude',
  requireRole('admin', 'owner'),
  complianceController.setCandidateRetentionExcludedHandler
);

// AVG art. 15 — kort-levende export-download-link vanaf kandidaat-detail.
router.post(
  '/:id/export-link',
  requireRole('admin', 'owner'),
  complianceController.createCandidateExportLinkHandler
);

router.get(
  '/:id/resumes/:resumeId/anonymized',
  complianceController.downloadAnonymizedResumeHandler
);

export default router;

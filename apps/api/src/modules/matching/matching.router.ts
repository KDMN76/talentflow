import { Router } from 'express';

import { requireAuth, requireRole } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';
import * as matchingController from './matching.controller';
import * as reactivationController from './reactivation.controller';
import * as talentFitController from './talentFit.controller';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// ─── Talent Fit Model (Sprint Q3.3) ─────────────────────────────────────────
// Train + ranked-by-job moeten VÓÓR de generieke /jobs/:jobId staan, anders
// matcht die eerst (Express matcht in volgorde).
router.post(
  '/talent-fit/train',
  requireRole('admin', 'owner'),
  talentFitController.trainHandler
);
router.get('/talent-fit/model', talentFitController.getModelHandler);
router.get('/talent-fit/predict', talentFitController.predictHandler);
router.get(
  '/talent-fit/jobs/:jobId/ranked',
  talentFitController.rankedHandler
);

// List endpoints — paginated by `?limit=` (default 20, max 100).
router.get('/jobs/:jobId', matchingController.getJobMatchesHandler);
router.get(
  '/candidates/:candidateId',
  matchingController.getCandidateMatchesHandler
);

// ─── Similar-hires explainer (Sprint Q3.3 — Agent ZZ) ───────────────────────
// Levert UI-context bij de Talent-Fit `similar_hire_count`-badge: namen,
// rollen, gedeelde skills van historische hires die op de query lijken.
// MOET vóór de generieke /candidates/:candidateId staan om route-collision
// te voorkomen.
router.get(
  '/candidates/:candidateId/similar-hires',
  matchingController.getSimilarHiresForCandidateHandler
);
router.get(
  '/jobs/:jobId/similar-hires',
  matchingController.getSimilarHiresForJobHandler
);

// Lazy AI explanation — only generated on demand by the recruiter UI.
// Cached in `match_scores.ai_explanation` for 7 days (configurable via
// MATCH_EXPLANATION_TTL_DAYS). Returns the EU AI Act disclosure.
router.post(
  '/jobs/:jobId/candidates/:candidateId/explanation',
  matchingController.generateMatchExplanationHandler
);

// ─── Talent reactivation alerts (Sprint Q3.2) ───────────────────────────────
// Stats-route MOET vóór /:id staan, anders matcht /:id eerst.
router.get('/reactivation-alerts/stats', reactivationController.getStats);
router.get('/reactivation-alerts', reactivationController.listAlerts);
router.post(
  '/reactivation-alerts/:id/acknowledge',
  requirePermission('candidates', 'write'),
  reactivationController.acknowledgeAlert
);
router.post(
  '/reactivation-alerts/:id/dismiss',
  requirePermission('candidates', 'write'),
  reactivationController.dismissAlert
);

export default router;

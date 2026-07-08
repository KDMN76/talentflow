import { Router } from 'express';
import * as analyticsController from './analytics.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/overview',            analyticsController.getOverview);
router.get('/funnel',              analyticsController.getFunnel);
router.get('/recruiters',          analyticsController.getRecruiterStats);
router.get('/sources',             analyticsController.getSourceBreakdown);
router.get('/time-to-hire-trend',  analyticsController.getTimeToHireTrend);
router.get('/applications-trend',  analyticsController.getApplicationsTrend);

// AI & Bias — Sprint Q4.6 (EU AI Act bias-monitoring). Alleen aggregaten,
// nooit individuele kandidaten; de statistische ondergrens zit in de
// adverse-impact-berekening (< 30 per groep = onvoldoende data).
router.get('/adverse-impact',           analyticsController.getAdverseImpact);
router.get('/ai-usage-trend',           analyticsController.getAiUsageTrend);
router.get('/match-score-distribution', analyticsController.getMatchScoreDistribution);

export default router;

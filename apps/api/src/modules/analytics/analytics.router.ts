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

export default router;

import { Router } from 'express';
import * as hmController from './hm.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/dashboard', hmController.getDashboard);
router.get('/stats', hmController.getStats);
router.get('/jobs', hmController.getMyJobs);
router.get('/reviews/pending', hmController.getPendingReviews);
router.get('/scorecards/deadlines', hmController.getScorecardDeadlines);
router.get('/applications/:id', hmController.getApplicationDetails);
router.post('/applications/:id/review', hmController.review);

export default router;

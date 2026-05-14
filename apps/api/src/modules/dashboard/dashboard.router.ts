import { Router } from 'express';
import * as dashboardController from './dashboard.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/stats', dashboardController.getStats);

export default router;

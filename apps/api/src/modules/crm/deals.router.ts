import { Router } from 'express';
import * as dealsController from './deals.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/', dealsController.listDeals);
router.post('/', dealsController.createDeal);
router.get('/pipeline/board', dealsController.getDealsPipeline);
router.get('/:id', dealsController.getDeal);
router.patch('/:id', dealsController.updateDeal);
router.delete('/:id', dealsController.deleteDeal);
router.patch('/:id/stage', dealsController.moveDealStage);

export default router;

import { Router } from 'express';
import * as dealsController from './deals.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requireWriteOnMutation } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);
// Muterende CRM-routes vereisen crm:write — read-only rollen (viewer) worden
// geblokkeerd; GET passeert.
router.use(requireWriteOnMutation('crm'));

router.get('/', dealsController.listDeals);
router.post('/', dealsController.createDeal);
router.get('/pipeline/board', dealsController.getDealsPipeline);
router.get('/:id', dealsController.getDeal);
router.patch('/:id', dealsController.updateDeal);
router.delete('/:id', dealsController.deleteDeal);
router.patch('/:id/stage', dealsController.moveDealStage);

export default router;

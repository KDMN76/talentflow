import { Router } from 'express';
import * as workflowsController from './workflows.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/',           workflowsController.listWorkflows);
router.post('/',          workflowsController.createWorkflow);
router.get('/:id',        workflowsController.getWorkflow);
router.patch('/:id',      workflowsController.updateWorkflow);
router.delete('/:id',     workflowsController.deleteWorkflow);
router.patch('/:id/toggle', workflowsController.toggleWorkflow);
router.get('/:id/runs',   workflowsController.getWorkflowRuns);

export default router;

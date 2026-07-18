import { Router } from 'express';
import * as workflowsController from './workflows.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/',           workflowsController.listWorkflows);
router.post('/',          requirePermission('workflows', 'write'), workflowsController.createWorkflow);
router.get('/:id',        workflowsController.getWorkflow);
router.patch('/:id',      requirePermission('workflows', 'write'), workflowsController.updateWorkflow);
router.delete('/:id',     requirePermission('workflows', 'write'), workflowsController.deleteWorkflow);
router.patch('/:id/toggle', requirePermission('workflows', 'write'), workflowsController.toggleWorkflow);
router.get('/:id/runs',   workflowsController.getWorkflowRuns);

export default router;

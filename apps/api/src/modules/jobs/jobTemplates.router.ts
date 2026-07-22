import { Router } from 'express';
import * as controller from './jobTemplates.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/', controller.list);
router.post('/', requirePermission('jobs', 'write'), controller.create);
router.get('/:id', controller.get);
router.delete('/:id', requirePermission('jobs', 'write'), controller.remove);
router.post('/:id/instantiate', requirePermission('jobs', 'write'), controller.instantiate);

export default router;

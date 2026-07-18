import { Router } from 'express';
import * as controller from './savedSearches.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/', controller.list);
router.post('/', requirePermission('saved_searches', 'write'), controller.create);
router.get('/:id', controller.get);
router.patch('/:id', requirePermission('saved_searches', 'write'), controller.update);
router.delete('/:id', requirePermission('saved_searches', 'write'), controller.remove);

export default router;

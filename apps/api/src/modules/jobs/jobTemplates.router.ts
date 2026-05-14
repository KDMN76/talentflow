import { Router } from 'express';
import * as controller from './jobTemplates.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.delete('/:id', controller.remove);
router.post('/:id/instantiate', controller.instantiate);

export default router;

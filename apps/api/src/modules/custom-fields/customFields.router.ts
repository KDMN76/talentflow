import { Router } from 'express';
import * as controller from './customFields.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// Read: open voor elke authenticated tenant-rol (formulieren moeten de
// custom-field-definities kunnen tonen). Write: alleen wie custom_fields:write
// heeft — dit is tenant-brede schema-config, geen per-record data.
router.get('/', controller.list);
router.post('/', requirePermission('custom_fields', 'write'), controller.create);
router.get('/:id', controller.get);
router.patch('/:id', requirePermission('custom_fields', 'write'), controller.update);
router.delete('/:id', requirePermission('custom_fields', 'write'), controller.remove);

export default router;

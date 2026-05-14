import { Router } from 'express';
import * as organizationsController from './organizations.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/', organizationsController.listOrganizations);
router.post('/', organizationsController.createOrganization);
router.get('/:id', organizationsController.getOrganization);
router.patch('/:id', organizationsController.updateOrganization);
router.delete('/:id', organizationsController.deleteOrganization);

export default router;

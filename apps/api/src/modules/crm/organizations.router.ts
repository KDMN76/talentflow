import { Router } from 'express';
import * as organizationsController from './organizations.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requireWriteOnMutation } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);
// Muterende CRM-routes vereisen crm:write — read-only rollen (viewer) worden
// geblokkeerd; GET passeert.
router.use(requireWriteOnMutation('crm'));

router.get('/', organizationsController.listOrganizations);
router.post('/', organizationsController.createOrganization);
router.get('/:id', organizationsController.getOrganization);
router.patch('/:id', organizationsController.updateOrganization);
router.delete('/:id', organizationsController.deleteOrganization);

export default router;

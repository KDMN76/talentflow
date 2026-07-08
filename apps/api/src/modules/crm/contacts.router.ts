import { Router } from 'express';
import * as contactsController from './contacts.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requireWriteOnMutation } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);
// Muterende CRM-routes vereisen crm:write — read-only rollen (viewer) worden
// geblokkeerd; GET passeert.
router.use(requireWriteOnMutation('crm'));

router.get('/', contactsController.listContacts);
router.post('/', contactsController.createContact);
router.get('/:id', contactsController.getContact);
router.patch('/:id', contactsController.updateContact);
router.delete('/:id', contactsController.deleteContact);

export default router;

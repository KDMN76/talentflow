import { Router } from 'express';
import * as contactsController from './contacts.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/', contactsController.listContacts);
router.post('/', contactsController.createContact);
router.get('/:id', contactsController.getContact);
router.patch('/:id', contactsController.updateContact);
router.delete('/:id', contactsController.deleteContact);

export default router;

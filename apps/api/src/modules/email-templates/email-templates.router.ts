import { Router } from 'express';
import * as emailTemplatesController from './email-templates.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/',       emailTemplatesController.listEmailTemplates);
router.post('/',      emailTemplatesController.createEmailTemplate);
router.get('/:id',    emailTemplatesController.getEmailTemplate);
router.patch('/:id',  emailTemplatesController.updateEmailTemplate);
router.delete('/:id', emailTemplatesController.deleteEmailTemplate);

export default router;

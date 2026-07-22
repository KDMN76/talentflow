import { Router } from 'express';
import * as emailTemplatesController from './email-templates.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// RBAC: mutaties vereisen communications:write; read blijft open voor elke
// authenticated tenant-rol.
router.get('/',       emailTemplatesController.listEmailTemplates);
router.post('/',      requirePermission('communications', 'write'), emailTemplatesController.createEmailTemplate);
router.get('/:id',    emailTemplatesController.getEmailTemplate);
router.patch('/:id',  requirePermission('communications', 'write'), emailTemplatesController.updateEmailTemplate);
router.delete('/:id', requirePermission('communications', 'write'), emailTemplatesController.deleteEmailTemplate);

export default router;

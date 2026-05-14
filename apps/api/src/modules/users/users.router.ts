import { Router } from 'express';
import * as usersController from './users.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// Current user routes — must come before /:id to avoid conflict
router.get('/me', usersController.getMe);
router.patch('/me', usersController.updateMe);

// Admin-only routes
router.get('/', requireRole('admin', 'super_admin'), usersController.listUsers);
router.post('/invite', requireRole('admin', 'super_admin'), usersController.inviteUser);
router.patch('/:id', usersController.updateUser);
router.delete('/:id', requireRole('admin', 'super_admin'), usersController.deactivateUser);

export default router;

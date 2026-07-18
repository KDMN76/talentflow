import { Router } from 'express';
import * as usersController from './users.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// Current user routes — must come before /:id to avoid conflict
router.get('/me', usersController.getMe);
router.patch('/me', usersController.updateMe);

// Admin-only routes. 'owner' erbij: dat is de rol van de tenant-aanmaker
// (auth.service.ts register()) — zonder 'owner' hier kon een vers
// geregistreerde tenant zijn eigen users nooit beheren.
router.get('/', requireRole('admin', 'super_admin', 'owner'), usersController.listUsers);
router.post('/invite', requireRole('admin', 'super_admin', 'owner'), usersController.inviteUser);
router.patch('/:id', usersController.updateUser);
router.delete('/:id', requireRole('admin', 'super_admin', 'owner'), usersController.deactivateUser);

export default router;

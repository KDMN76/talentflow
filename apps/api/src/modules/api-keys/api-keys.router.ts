import { Router } from 'express';
import * as apiKeysController from './api-keys.controller';
import * as playgroundController from './playground.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// Static routes vóór `/:id` om collisions te voorkomen.
router.get('/scopes', apiKeysController.getScopes);

router.get('/', apiKeysController.listKeys);
router.post('/', apiKeysController.createKey);

router.patch('/:id', apiKeysController.updateKey);
router.post('/:id/rotate', apiKeysController.rotateKey);
router.delete('/:id', apiKeysController.revokeKey);

router.get('/:id/usage', apiKeysController.getUsage);
router.get('/:id/stats', apiKeysController.getStats);

export default router;

// Aparte router voor playground (mount op /api/api-explorer)
export const apiExplorerRouter = Router();
apiExplorerRouter.use(requireAuth, tenantMiddleware);
apiExplorerRouter.post('/run', playgroundController.runRequest);

import { Router } from 'express';
import * as apiKeysController from './api-keys.controller';
import * as playgroundController from './playground.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// Static routes vóór `/:id` om collisions te voorkomen.
router.get('/scopes', apiKeysController.getScopes);

router.get('/', apiKeysController.listKeys);
// Sleutel-mutaties zijn credential-uitgifte: `integrations:write` vereist
// (read-only rollen zoals viewer konden hier eerst zonder check sleutels
// minten/roteren/intrekken — viewer-gap gedicht).
router.post('/', requirePermission('integrations', 'write'), apiKeysController.createKey);

router.patch('/:id', requirePermission('integrations', 'write'), apiKeysController.updateKey);
router.post('/:id/rotate', requirePermission('integrations', 'write'), apiKeysController.rotateKey);
router.delete('/:id', requirePermission('integrations', 'write'), apiKeysController.revokeKey);

router.get('/:id/usage', apiKeysController.getUsage);
router.get('/:id/stats', apiKeysController.getStats);

export default router;

// Aparte router voor playground (mount op /api/api-explorer)
export const apiExplorerRouter = Router();
apiExplorerRouter.use(requireAuth, tenantMiddleware);
apiExplorerRouter.post('/run', playgroundController.runRequest);

import { Router } from 'express';
import * as webhooksController from './webhooks.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// RBAC: webhooks is een PermissionResource (lib/permissions.ts) maar werd
// hier nergens gecheckt — elke authenticated tenant-user kon subscriptions
// aanmaken/verwijderen én (erger) de raw HMAC-secret uitlezen via list.
// `write` sluit `viewer` uit (viewer heeft nergens write:true, zie
// readOnlyMatrix); alleen admin/super_admin hebben webhooks:write. `read`
// staat open voor viewer maar wordt bewust NIET gebruikt op de list-routes
// hieronder, want die retourneren het secret — zie ook webhooks.service.ts.

// ── Subscriptions ───────────────────────────────────────────────────────────
// Both /subscriptions and / (legacy) zijn ondersteund. Zo blijven oudere
// clients werken terwijl nieuwe code de expliciete prefix gebruikt.

router.get('/subscriptions', requirePermission('webhooks', 'write'), webhooksController.listWebhooks);
router.post('/subscriptions', requirePermission('webhooks', 'write'), webhooksController.createWebhook);
router.patch('/subscriptions/:id', requirePermission('webhooks', 'write'), webhooksController.updateWebhook);
router.delete('/subscriptions/:id', requirePermission('webhooks', 'write'), webhooksController.deleteWebhook);
router.patch('/subscriptions/:id/toggle', requirePermission('webhooks', 'write'), webhooksController.toggleWebhook);
router.post('/subscriptions/:id/rotate-secret', requirePermission('webhooks', 'write'), webhooksController.rotateWebhookSecret);
router.get('/subscriptions/:id/logs', requirePermission('webhooks', 'read'), webhooksController.getWebhookLogs);

// ── Deliveries (event-log) ──────────────────────────────────────────────────

router.get('/deliveries', requirePermission('webhooks', 'read'), webhooksController.listDeliveries);
router.get('/deliveries/:id', requirePermission('webhooks', 'read'), webhooksController.getDelivery);
router.post('/deliveries/:id/retry', requirePermission('webhooks', 'write'), webhooksController.retryDelivery);

// ── Test-tool + event-types ─────────────────────────────────────────────────

router.post('/test', requirePermission('webhooks', 'write'), webhooksController.testWebhook);
router.get('/event-types', requirePermission('webhooks', 'read'), webhooksController.listEventTypes);

// ── Legacy aliases ──────────────────────────────────────────────────────────
// Behouden voor de bestaande Settings-page in apps/web.

router.get('/', requirePermission('webhooks', 'write'), webhooksController.listWebhooks);
router.post('/', requirePermission('webhooks', 'write'), webhooksController.createWebhook);
router.patch('/:id', requirePermission('webhooks', 'write'), webhooksController.updateWebhook);
router.delete('/:id', requirePermission('webhooks', 'write'), webhooksController.deleteWebhook);
router.patch('/:id/toggle', requirePermission('webhooks', 'write'), webhooksController.toggleWebhook);
router.post('/:id/rotate-secret', requirePermission('webhooks', 'write'), webhooksController.rotateWebhookSecret);
router.get('/:id/logs', requirePermission('webhooks', 'read'), webhooksController.getWebhookLogs);

export default router;

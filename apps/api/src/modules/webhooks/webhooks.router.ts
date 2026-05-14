import { Router } from 'express';
import * as webhooksController from './webhooks.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// ── Subscriptions ───────────────────────────────────────────────────────────
// Both /subscriptions and / (legacy) zijn ondersteund. Zo blijven oudere
// clients werken terwijl nieuwe code de expliciete prefix gebruikt.

router.get('/subscriptions', webhooksController.listWebhooks);
router.post('/subscriptions', webhooksController.createWebhook);
router.patch('/subscriptions/:id', webhooksController.updateWebhook);
router.delete('/subscriptions/:id', webhooksController.deleteWebhook);
router.patch('/subscriptions/:id/toggle', webhooksController.toggleWebhook);
router.post('/subscriptions/:id/rotate-secret', webhooksController.rotateWebhookSecret);
router.get('/subscriptions/:id/logs', webhooksController.getWebhookLogs);

// ── Deliveries (event-log) ──────────────────────────────────────────────────

router.get('/deliveries', webhooksController.listDeliveries);
router.get('/deliveries/:id', webhooksController.getDelivery);
router.post('/deliveries/:id/retry', webhooksController.retryDelivery);

// ── Test-tool + event-types ─────────────────────────────────────────────────

router.post('/test', webhooksController.testWebhook);
router.get('/event-types', webhooksController.listEventTypes);

// ── Legacy aliases ──────────────────────────────────────────────────────────
// Behouden voor de bestaande Settings-page in apps/web.

router.get('/', webhooksController.listWebhooks);
router.post('/', webhooksController.createWebhook);
router.patch('/:id', webhooksController.updateWebhook);
router.delete('/:id', webhooksController.deleteWebhook);
router.patch('/:id/toggle', webhooksController.toggleWebhook);
router.post('/:id/rotate-secret', webhooksController.rotateWebhookSecret);
router.get('/:id/logs', webhooksController.getWebhookLogs);

export default router;

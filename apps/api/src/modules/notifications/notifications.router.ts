/**
 * Notifications router — Sprint Q2.4.
 *
 * Mount: app.use('/api/notifications', notificationsRouter).
 *
 * Layout:
 *   - GET /vapid-public-key                     auth-protected (MVP keuze)
 *   - POST /subscribe                           registreer push-sub
 *   - GET  /subscriptions                       lijst eigen subs
 *   - DELETE /subscriptions/:id                 deactiveer sub
 *   - GET  /devices                             alias: subs als { devices: [...] }
 *   - DELETE /devices/:id                       alias van /subscriptions/:id
 *
 *   - GET   /preferences                        lijst eigen preferences
 *   - PATCH /preferences                        upsert per (channel, event_type)
 *
 *   - GET  /log                                 recente delivery-log
 *   - POST /test                                stuur test-push naar eigen device(s)
 *   - POST /log/:id/clicked                     click-tracker (vanuit service-worker)
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import * as ctrl from './notifications.controller';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/vapid-public-key', ctrl.getVapidKey);

router.post('/subscribe', ctrl.subscribe);
router.get('/subscriptions', ctrl.listSubscriptions);
router.delete('/subscriptions/:id', ctrl.deleteSubscription);

// Device-aliases — zelfde service-laag, maar het shape dat de
// settings/notifications-pagina verwacht ({ devices: [...] }).
router.get('/devices', ctrl.listDevices);
router.delete('/devices/:id', ctrl.deleteSubscription);

router.get('/preferences', ctrl.getPreferences);
router.patch('/preferences', ctrl.patchPreferences);

router.get('/log', ctrl.getLog);
router.post('/test', ctrl.sendTest);
router.post('/log/:id/clicked', ctrl.markClicked);

export default router;

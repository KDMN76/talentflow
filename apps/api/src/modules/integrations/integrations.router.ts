/**
 * Integrations router — Sprint Q3.1.
 *
 * Mount-point: `/api/integrations`.
 *
 * De OAuth-callback is **publiek** (geen auth-middleware): de provider stuurt
 * een GET met `code` + `state` zonder onze JWT te kunnen meesturen. We
 * vertrouwen op het state-token (uuid) dat we in Redis tegen tenant/user
 * matchen.
 *
 * Alle andere routes zijn auth-protected.
 */

import { Router } from 'express';
import * as integrationsController from './integrations.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

// ─── Public callback (geen auth — state-token is volledige authenticatie) ──
router.get('/mailbox/oauth/callback', integrationsController.oauthCallbackHandler);

// ─── Authenticated routes ──────────────────────────────────────────────────
router.use(requireAuth, tenantMiddleware);

router.get('/mailbox', integrationsController.listMailboxIntegrationsHandler);
router.get(
  '/mailbox/oauth/:provider/start',
  integrationsController.startOAuthHandler
);
router.delete('/mailbox/:id', integrationsController.disconnectIntegrationHandler);

export default router;

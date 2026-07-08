import { Router } from 'express';
import * as communicationsController from './communications.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// Verzenden vereist `communications:write` — read-only rollen (viewer)
// konden eerst zonder check echte e-mail/SMS/WhatsApp en bulk-campagnes
// versturen (viewer-gap gedicht).

// Inbox — all recent communications across candidates
router.get('/inbox', communicationsController.getInbox);

// Generic transactional email endpoint (ComposeEmailModal target)
router.post('/send', requirePermission('communications', 'write'), communicationsController.enqueueEmail);

// Bulk-campaigns (Sprint Q3.1)
router.post('/bulk-campaign', requirePermission('communications', 'write'), communicationsController.startBulkCampaignHandler);
router.get('/bulk-campaigns', communicationsController.listBulkCampaignsHandler);
router.get('/bulk-campaigns/:id', communicationsController.getBulkCampaignHandler);

// Per-candidate communications
router.get('/candidates/:candidateId', communicationsController.getCandidateCommunications);
router.post('/candidates/:candidateId/email', requirePermission('communications', 'write'), communicationsController.sendEmail);
router.post('/candidates/:candidateId/whatsapp', requirePermission('communications', 'write'), communicationsController.sendWhatsApp);
router.post('/candidates/:candidateId/sms', requirePermission('communications', 'write'), communicationsController.sendSms);

export default router;

import { Router } from 'express';
import * as communicationsController from './communications.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// Inbox — all recent communications across candidates
router.get('/inbox', communicationsController.getInbox);

// Generic transactional email endpoint (ComposeEmailModal target)
router.post('/send', communicationsController.enqueueEmail);

// Bulk-campaigns (Sprint Q3.1)
router.post('/bulk-campaign', communicationsController.startBulkCampaignHandler);
router.get('/bulk-campaigns', communicationsController.listBulkCampaignsHandler);
router.get('/bulk-campaigns/:id', communicationsController.getBulkCampaignHandler);

// Per-candidate communications
router.get('/candidates/:candidateId', communicationsController.getCandidateCommunications);
router.post('/candidates/:candidateId/email', communicationsController.sendEmail);
router.post('/candidates/:candidateId/whatsapp', communicationsController.sendWhatsApp);
router.post('/candidates/:candidateId/sms', communicationsController.sendSms);

export default router;

import { Router } from 'express';
import * as emailInboundController from './email-inbound.controller';

// Public webhook endpoint — geen auth-middleware (Resend levert het aan).
// Authenticiteit wordt geverifieerd via HMAC-SHA256 op `RESEND_WEBHOOK_SECRET`.
const router = Router();

router.post('/email-inbound', emailInboundController.handleInboundEmail);

export default router;

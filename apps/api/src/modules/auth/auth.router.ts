import { Router } from 'express';
import * as authController from './auth.controller';
import * as twoFa from './twoFactor.controller';
import { authRateLimit } from '../../middleware/rateLimit';
import { requireAuth, requireRole } from '../../middleware/auth';

const router = Router();

router.post('/register', authRateLimit, authController.register);
router.post('/login', authRateLimit, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post('/forgot-password', authRateLimit, authController.forgotPassword);

// ─── Sprint Q4.2 — 2FA TOTP ─────────────────────────────────────────────────
// /verify gebruikt een partial-token (geen volledige JWT) — geen requireAuth.
router.post('/2fa/verify', authRateLimit, twoFa.verify);

// Authenticated 2FA-management
router.post('/2fa/setup', requireAuth, twoFa.setup);
router.post('/2fa/verify-setup', requireAuth, twoFa.verifySetup);
router.post('/2fa/disable', requireAuth, twoFa.disable);
router.post('/2fa/backup-codes/regenerate', requireAuth, twoFa.regenerateBackupCodes);

// Tenant 2FA policy — admin/owner only
router.get('/2fa/policy', requireAuth, requireRole('admin', 'owner'), twoFa.getPolicy);
router.put('/2fa/policy', requireAuth, requireRole('admin', 'owner'), twoFa.setPolicy);

export default router;

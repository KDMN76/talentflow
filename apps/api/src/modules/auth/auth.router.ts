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
// Reset-password: token is de credential (geen requireAuth), net als /accept-invite.
router.post('/reset-password', authRateLimit, authController.resetPassword);
// Accept-invite: token is de credential (geen requireAuth), net als /forgot-password.
router.post('/accept-invite', authRateLimit, authController.acceptInvite);

// ─── Sprint Q4.2 — 2FA TOTP ─────────────────────────────────────────────────
// /verify gebruikt een partial-token (geen volledige JWT) — geen requireAuth.
router.post('/2fa/verify', authRateLimit, twoFa.verify);

// Authenticated 2FA-management
router.get('/2fa/status', requireAuth, twoFa.status);
router.post('/2fa/setup', requireAuth, twoFa.setup);
router.post('/2fa/verify-setup', requireAuth, twoFa.verifySetup);
router.post('/2fa/disable', requireAuth, twoFa.disable);
router.post('/2fa/backup-codes/regenerate', requireAuth, twoFa.regenerateBackupCodes);

// Tenant 2FA policy — admin/owner only
router.get('/2fa/policy', requireAuth, requireRole('admin', 'owner'), twoFa.getPolicy);
router.put('/2fa/policy', requireAuth, requireRole('admin', 'owner'), twoFa.setPolicy);

export default router;

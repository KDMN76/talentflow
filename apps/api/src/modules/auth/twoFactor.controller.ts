/**
 * 2FA controller — Sprint Q4.2 (Agent NNN).
 *
 * Mounted op /api/auth/2fa/* via auth.router. Setup + verify-setup +
 * regenerate vereisen JWT (gebruiker moet ingelogd zijn). De /verify
 * route accepteert juist een partial-token (geen volledige JWT) zodat
 * de login-flow afgemaakt kan worden.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as twoFa from './twoFactor.service';
import * as authService from './auth.service';
import { AppError } from '../../middleware/errorHandler';
import { auditCtxFromReq, logAudit } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { withoutTenant } from '../../db/pool';

const REFRESH_COOKIE = 'refreshToken';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

// ── /api/auth/2fa/setup ─────────────────────────────────────────────────────

export async function setup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Authenticatie vereist');
    const result = await twoFa.generateTotpSecret(
      req.user.userId,
      req.user.tenantId,
      auditCtxFromReq(req)
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

const verifySetupSchema = z.object({ code: z.string().min(6).max(10) });

export async function verifySetup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Authenticatie vereist');
    const { code } = verifySetupSchema.parse(req.body);
    await twoFa.verifyTotpAndEnable(req.user.userId, code, auditCtxFromReq(req));
    res.json({ enabled: true });
  } catch (err) {
    next(err);
  }
}

// ── /api/auth/2fa/verify (during login) ─────────────────────────────────────

const verifySchema = z.object({
  partial_token: z.string().min(1),
  code: z.string().min(6).max(10),
});

export async function verify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { partial_token, code } = verifySchema.parse(req.body);
    const partial = authService.verifyPartialToken(partial_token);

    // Probeer eerst TOTP, anders backup-code (UX: één endpoint).
    const ctx = auditCtxFromReq(req);
    let ok = await twoFa.verifyTotpCode(partial.userId, code);
    let usedBackup = false;
    if (!ok) {
      ok = await twoFa.verifyBackupCode(partial.userId, code, ctx);
      usedBackup = ok;
    }
    if (!ok) {
      throw new AppError(401, 'INVALID_2FA_CODE', 'Ongeldige verificatiecode');
    }

    // Haal user op voor naam (we hebben 'm niet in de partial-token).
    const user = await withoutTenant(async (client) => {
      const { rows } = await client.query<{ name: string }>(
        'SELECT name FROM users WHERE id = $1',
        [partial.userId]
      );
      return rows[0] ?? null;
    });

    const session = await authService.issueSessionForUser(
      partial.userId,
      partial.tenantId,
      partial.email,
      partial.role,
      user?.name ?? partial.email,
      ctx
    );

    if (usedBackup) {
      // Audit-extra: backup-code used (de service logt 'm ook al in twoFactor.service)
      await withoutTenant(async (client) => {
        await client.query(`SET LOCAL app.tenant_id = '${partial.tenantId}'`);
        await logAudit(
          client,
          partial.tenantId,
          {
            action: AuditActions.USER_2FA_VERIFIED,
            entityType: 'user',
            entityId: partial.userId,
            after: { method: 'backup_code' },
            userId: partial.userId,
          },
          ctx
        );
      });
    } else {
      await withoutTenant(async (client) => {
        await client.query(`SET LOCAL app.tenant_id = '${partial.tenantId}'`);
        await logAudit(
          client,
          partial.tenantId,
          {
            action: AuditActions.USER_2FA_VERIFIED,
            entityType: 'user',
            entityId: partial.userId,
            after: { method: 'totp' },
            userId: partial.userId,
          },
          ctx
        );
      });
    }

    res.cookie(REFRESH_COOKIE, session.refreshToken, COOKIE_OPTIONS);
    res.json({
      accessToken: session.accessToken,
      user: session.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── /api/auth/2fa/disable ───────────────────────────────────────────────────

const disableSchema = z.object({ code: z.string().min(6).max(10) });

export async function disable(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Authenticatie vereist');
    const { code } = disableSchema.parse(req.body);
    await twoFa.disable2fa(req.user.userId, code, auditCtxFromReq(req));
    res.json({ disabled: true });
  } catch (err) {
    next(err);
  }
}

// ── /api/auth/2fa/backup-codes/regenerate ───────────────────────────────────

export async function regenerateBackupCodes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Authenticatie vereist');
    const { code } = disableSchema.parse(req.body);
    const codes = await twoFa.regenerateBackupCodes(
      req.user.userId,
      code,
      auditCtxFromReq(req)
    );
    res.json({ backup_codes: codes });
  } catch (err) {
    next(err);
  }
}

// ── /api/admin/2fa/policy ───────────────────────────────────────────────────
// Tenant 2FA policy management — alleen admin/owner.

export async function getPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Authenticatie vereist');
    const policy = await twoFa.getTenant2faPolicy(req.user.tenantId);
    res.json(
      policy ?? {
        tenant_id: req.user.tenantId,
        required_for_roles: [],
        required_for_all: false,
        grace_period_days: 7,
      }
    );
  } catch (err) {
    next(err);
  }
}

const setPolicySchema = z.object({
  required_for_roles: z.array(z.string()).optional(),
  required_for_all: z.boolean().optional(),
  grace_period_days: z.number().int().min(0).max(90).optional(),
});

export async function setPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Authenticatie vereist');
    const input = setPolicySchema.parse(req.body);
    const policy = await twoFa.setTenant2faPolicy(
      req.user.tenantId,
      req.user.userId,
      input,
      auditCtxFromReq(req)
    );
    res.json(policy);
  } catch (err) {
    next(err);
  }
}

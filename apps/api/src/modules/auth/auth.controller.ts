import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from './auth.service';
import { AppError } from '../../middleware/errorHandler';
import { auditCtxFromReq } from '../../lib/audit';

const REFRESH_COOKIE = 'refreshToken';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
};

const registerSchema = z.object({
  tenantName: z.string().min(2).max(100),
  tenantSlug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Slug mag alleen kleine letters, cijfers en koppeltekens bevatten'),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantSlug: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  tenantSlug: z.string().min(1),
});

const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});

const acceptInviteSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Hotfix 2026-05-15: publieke open registratie tijdelijk dicht. Iedereen
    // kon een tenant aanmaken zonder verwerkersovereenkomst → AVG-risico +
    // onverwachte users die crashende modules raken. Invite-only flow komt
    // morgen. Schakel uit met env-var DISABLE_PUBLIC_REGISTRATION=true.
    if (process.env.DISABLE_PUBLIC_REGISTRATION === 'true') {
      throw new AppError(
        403,
        'REGISTRATION_DISABLED',
        'Publieke registratie is uitgeschakeld. Neem contact op voor toegang.'
      );
    }

    const input = registerSchema.parse(req.body);
    const result = await authService.register(input, auditCtxFromReq(req));

    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);

    res.status(201).json({
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input, auditCtxFromReq(req));

    // 2FA challenge — geef partial-token terug, frontend redirect naar /2fa
    if ('requires_2fa' in result) {
      res.json({
        requires_2fa: true,
        partial_token: result.partial_token,
      });
      return;
    }

    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);

    res.json({
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!refreshToken) {
      throw new AppError(401, 'NO_REFRESH_TOKEN', 'Geen refresh token aanwezig');
    }

    const result = await authService.refreshAccessToken(refreshToken);
    // Rotatie (Fase 0.5): elke refresh levert een nieuwe single-use token op;
    // de cookie moet mee-roteren, anders replayt de browser de oude token en
    // logt de reuse-detectie de gebruiker direct overal uit.
    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    res.json({ accessToken: result.accessToken });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    res.json({ message: 'Uitgelogd' });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, tenantSlug } = forgotPasswordSchema.parse(req.body);
    await authService.forgotPassword(email, tenantSlug, auditCtxFromReq(req));
    // Always return 200 to prevent email enumeration
    res.json({ message: 'Als dit e-mailadres bestaat, ontvangt u een e-mail' });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(input.token, input.password, auditCtxFromReq(req));
    // Geen auto-login: alle sessies zijn zojuist ingetrokken; de gebruiker
    // logt opnieuw in met het nieuwe wachtwoord.
    res.json({ message: 'Wachtwoord is opnieuw ingesteld' });
  } catch (err) {
    next(err);
  }
}

export async function acceptInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = acceptInviteSchema.parse(req.body);
    const result = await authService.acceptInvite(
      input.token,
      input.password,
      auditCtxFromReq(req)
    );

    // Net als login/register: refresh-cookie zetten + accessToken teruggeven,
    // zodat de gebruiker direct is ingelogd na het instellen van het wachtwoord.
    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    res.json({
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
}

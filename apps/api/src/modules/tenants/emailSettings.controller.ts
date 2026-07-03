/**
 * Tenant e-mailinstellingen — controller.
 *
 * Routes (zie tenants.router.ts, allemaal admin-only):
 *   GET  /api/tenants/email-settings       → huidige instellingen (nooit het wachtwoord)
 *   PUT  /api/tenants/email-settings       → upsert (smtp_pass is write-only)
 *   POST /api/tenants/email-settings/test  → testmail via de gekozen transport,
 *        UITSLUITEND naar het eigen (geverifieerde) e-mailadres van de
 *        ingelogde admin — het adres is niet client-instelbaar. Rate-limited.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as emailSettingsService from './emailSettings.service';
import { assertSafeSmtpTarget, sendTenantEmail } from '../../lib/tenantMailer';
import { AppError, logger } from '../../middleware/errorHandler';
import { withTenant } from '../../db/pool';
import { logAudit, auditCtxFromReq } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

// Lege string uit een formulier behandelen we als "wissen" (null).
const emptyToNull = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? null : v;

const optionalEmail = z.preprocess(
  emptyToNull,
  z.string().trim().email().max(320).nullable().optional()
);
const optionalString = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

const putSchema = z.object({
  from_name: optionalString(200),
  reply_to: optionalEmail,
  smtp_enabled: z.boolean().optional(),
  smtp_host: optionalString(500),
  smtp_port: z.number().int().min(1).max(65535).nullable().optional(),
  smtp_secure: z.boolean().optional(),
  smtp_user: optionalString(500),
  // Write-only: weglaten = ongewijzigd, '' of null = wissen, string = nieuw.
  smtp_pass: z.string().max(1000).nullable().optional(),
  smtp_from: optionalEmail,
});

export async function getEmailSettings(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const settings = await emailSettingsService.getTenantEmailSettings(
      req.user!.tenantId
    );
    res.json({
      data: {
        ...settings,
        // Voor de UI-preview ("IT Proposal <no-reply@send.kdmn.nl>").
        global_from_address: emailSettingsService.getGlobalFromAddress(),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function putEmailSettings(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = putSchema.parse(req.body);
    // SSRF-guard: geen interne hosts/poorten opslaan (zie tenantMailer).
    if (typeof input.smtp_host === 'string') {
      assertSafeSmtpTarget(input.smtp_host, input.smtp_port ?? null);
    }
    const settings = await emailSettingsService.upsertTenantEmailSettings(
      req.user!.tenantId,
      // '' voor smtp_pass = expliciet wissen (service behandelt '' als null).
      input,
      req
    );
    res.json({
      data: {
        ...settings,
        global_from_address: emailSettingsService.getGlobalFromAddress(),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function sendTestEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    // Security: het doeladres komt UITSLUITEND uit het JWT van de ingelogde
    // admin — nooit uit de request-body.
    const to = req.user!.email;
    if (!to || !to.includes('@')) {
      throw new AppError(
        400,
        'NO_USER_EMAIL',
        'Geen geldig e-mailadres bekend voor je account.'
      );
    }

    let result;
    try {
      result = await sendTenantEmail(tenantId, {
        to,
        subject: 'TalentFlow — testmail e-mailinstellingen',
        html:
          '<p>Dit is een testmail vanuit je TalentFlow e-mailinstellingen.</p>' +
          '<p>Komt deze mail goed binnen (juiste afzendernaam, geen spam-map), ' +
          'dan staan je instellingen correct.</p>',
        text:
          'Dit is een testmail vanuit je TalentFlow e-mailinstellingen. ' +
          'Komt deze mail goed binnen, dan staan je instellingen correct.',
      });
    } catch (sendErr) {
      // Generieke fout naar de client: de rauwe transport-error (connection
      // refused vs timeout vs protocol) zou anders als recon-orakel voor
      // interne hosts dienen. Details alleen server-side loggen.
      logger.warn('[emailSettings] testmail mislukt', {
        tenantId,
        error: (sendErr as Error).message,
      });
      if (sendErr instanceof AppError) throw sendErr; // eigen 400-validaties
      throw new AppError(
        502,
        'EMAIL_TEST_FAILED',
        'Testmail kon niet worden verzonden. Controleer host, poort, ' +
          'beveiliging (SSL/TLS) en inloggegevens.'
      );
    }

    // Audit-spoor (best-effort, buiten de send-flow).
    await withTenant(tenantId, async (client) => {
      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.TENANT_EMAIL_TEST_SENT,
          entityType: 'tenant_email_settings',
          entityId: tenantId,
          userId: req.user?.userId ?? null,
          after: { to, provider: result.provider, mocked: result.mocked ?? false },
        },
        auditCtxFromReq(req)
      );
    }).catch((err: Error) => {
      logger.warn('[emailSettings] audit voor testmail mislukt', {
        tenantId,
        error: err.message,
      });
    });

    res.json({
      data: {
        sent: true,
        to,
        provider: result.provider,
        mocked: result.mocked ?? false,
        messageId: result.messageId,
      },
    });
  } catch (err) {
    next(err);
  }
}

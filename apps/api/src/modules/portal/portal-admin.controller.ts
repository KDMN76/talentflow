/**
 * Portal-admin controller — Sprint Q2.1.
 *
 * Bevat de auth-protected handlers die de bestaande portal.controller.ts
 * NIET overneemt:
 *   - PATCH /api/portals/:id          → permissions/branding/notify-config
 *   - POST  /api/portals/:id/rotate-token
 *   - GET   /api/portals/:id/activity
 *   - POST  /api/portals/:id/verify-domain
 *
 * Bestaande GET/POST/DELETE op /api/portals blijven in portal.controller.ts.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as portalService from './portal.service';
import { AppError } from '../../middleware/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const granularPermissionsSchema = z
  .object({
    view_candidates: z.boolean().optional(),
    view_resumes: z.boolean().optional(),
    view_ai_scores: z.boolean().optional(),
    view_contact_info: z.boolean().optional(),
    accept_reject: z.boolean().optional(),
    comment: z.boolean().optional(),
    download_cv: z.boolean().optional(),
    view_pipeline_history: z.boolean().optional(),
    // Legacy keys — silently mapped door normalizePermissions().
    view: z.boolean().optional(),
    approve: z.boolean().optional(),
    reject: z.boolean().optional(),
  })
  .strict()
  .optional();

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const brandingSchema = z
  .object({
    logo_url: z.string().url().max(2048).nullable().optional(),
    favicon_url: z.string().url().max(2048).nullable().optional(),
    primary_color: z.string().regex(HEX_COLOR).nullable().optional(),
    accent_color: z.string().regex(HEX_COLOR).nullable().optional(),
    brand_name: z.string().min(1).max(100).nullable().optional(),
    email_footer: z.string().max(5000).nullable().optional(),
  })
  .partial()
  .optional();

// RFC1123 hostname (subset — accepteert Punycode-gepunte representaties).
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const updateSchema = z.object({
  client_name: z.string().min(1).max(200).nullable().optional(),
  permissions: granularPermissionsSchema,
  expires_at: z.string().datetime().nullable().optional(),
  custom_domain: z
    .string()
    .toLowerCase()
    .regex(HOSTNAME_RE, 'Ongeldige hostname')
    .nullable()
    .optional(),
  branding: brandingSchema,
  notify_email: z.string().email().nullable().optional(),
  notification_frequency: z.enum(['realtime', 'daily', 'weekly', 'off']).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function patchPortalLink(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.params.id) {
      throw new AppError(400, 'MISSING_ID', 'Portal-id is verplicht');
    }
    const data = updateSchema.parse(req.body);
    const link = await portalService.updatePortalLink(
      req.user!.tenantId,
      req.params.id,
      data
    );
    res.json({ data: link });
  } catch (err) {
    next(err);
  }
}

export async function rotateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await portalService.rotatePortalToken(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getActivity(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 500);
    const activity = await portalService.getPortalActivityLog(
      req.user!.tenantId,
      req.params.id,
      limit
    );
    res.json({ data: activity });
  } catch (err) {
    next(err);
  }
}

export async function verifyDomain(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await portalService.verifyCustomDomain(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

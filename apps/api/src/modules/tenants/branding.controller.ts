import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as brandingService from './branding.service';
import * as brandingLogoService from './brandingLogo.service';
import { AppError } from '../../middleware/errorHandler';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const upsertSchema = z.object({
  logo_url: z.string().url().max(2048).nullable().optional(),
  favicon_url: z.string().url().max(2048).nullable().optional(),
  primary_color: z.string().regex(HEX_COLOR).nullable().optional(),
  accent_color: z.string().regex(HEX_COLOR).nullable().optional(),
  brand_name: z.string().min(1).max(100).nullable().optional(),
  email_footer: z.string().max(5000).nullable().optional(),
});

export async function getBranding(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const branding = await brandingService.getTenantBranding(req.user!.tenantId);
    res.json({ data: branding });
  } catch (err) {
    next(err);
  }
}

export async function putBranding(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = upsertSchema.parse(req.body);
    const branding = await brandingService.upsertTenantBranding(req.user!.tenantId, data);
    res.json({ data: branding });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/tenants/branding/logo — multipart upload (veld `logo`).
 * Validatie (grootte, mime-allowlist, magic bytes, SVG-scrub) gebeurt in
 * brandingLogo.service.ts; multer levert hier alleen de memory-buffer aan.
 */
export async function postBrandingLogo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const file = req.file;
    if (!file || !file.buffer) {
      throw new AppError(400, 'NO_FILE', 'Geen bestand meegestuurd (multipart-veld "logo").');
    }
    const branding = await brandingLogoService.uploadTenantLogo(req.user!.tenantId, {
      buffer: file.buffer,
      mimetype: file.mimetype,
    });
    res.json({ data: branding });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/tenants/branding/logo — verwijdert geupload logo + storage-object. */
export async function deleteBrandingLogo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const branding = await brandingLogoService.deleteTenantLogo(req.user!.tenantId);
    res.json({ data: branding });
  } catch (err) {
    next(err);
  }
}

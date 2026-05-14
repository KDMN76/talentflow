import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as brandingService from './branding.service';

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

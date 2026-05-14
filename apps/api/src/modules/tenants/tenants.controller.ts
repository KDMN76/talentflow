import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as tenantsService from './tenants.service';

const updateTenantSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  settings: z.record(z.unknown()).optional(),
});

export async function getCurrentTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenant = await tenantsService.getTenant(req.user!.tenantId);
    res.json(tenant);
  } catch (err) {
    next(err);
  }
}

export async function updateCurrentTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateTenantSchema.parse(req.body);
    const tenant = await tenantsService.updateTenant(req.user!.tenantId, data);
    res.json(tenant);
  } catch (err) {
    next(err);
  }
}

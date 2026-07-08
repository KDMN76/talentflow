/**
 * Module-flags endpoints — per-tenant module-zichtbaarheid (migration 050).
 *
 *   GET /api/tenants/modules  → elke geauthenticeerde user (sidebar-filtering)
 *   PUT /api/tenants/modules  → admin-only (router), audit-event in service
 *
 * Response-shape:
 *   { data: { modules: { <key>: boolean, ... }, module_keys: [...] } }
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  MODULE_KEYS,
  getModuleFlags,
  updateModuleFlags,
} from './moduleFlags.service';
import { auditCtxFromReq } from '../../lib/audit';

// Alleen bekende module-keys, alleen booleans, minimaal één key.
// `.strict()` weigert onbekende keys expliciet met een 400 i.p.v. ze stil
// weg te gooien — dat vangt typo's in API-clients vroeg af.
const putModulesSchema = z
  .object(
    Object.fromEntries(
      MODULE_KEYS.map((key) => [key, z.boolean().optional()])
    ) as Record<(typeof MODULE_KEYS)[number], z.ZodOptional<z.ZodBoolean>>
  )
  .strict()
  .refine((obj) => Object.values(obj).some((v) => v !== undefined), {
    message: 'Minimaal één module-key vereist',
  });

export async function getModules(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const modules = await getModuleFlags(req.user!.tenantId);
    res.json({ data: { modules, module_keys: MODULE_KEYS } });
  } catch (err) {
    next(err);
  }
}

export async function putModules(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const patch = putModulesSchema.parse(req.body ?? {});
    const modules = await updateModuleFlags(
      req.user!.tenantId,
      patch,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ data: { modules, module_keys: MODULE_KEYS } });
  } catch (err) {
    next(err);
  }
}

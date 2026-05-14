/**
 * Roles controller — Sprint Q4.2 (Agent OOO).
 *
 * HTTP-laag bovenop customRoles.service.ts. Validatie via zod, audit-context
 * via auditCtxFromReq. Errors bubbelen naar errorHandler die ze naar JSON
 * vertaalt.
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auditCtxFromReq } from '../../lib/audit';
import { getCurrentPermissionMatrix } from '../../middleware/permissions';
import * as service from './customRoles.service';
import {
  PERMISSION_RESOURCES,
  PERMISSION_ACTIONS,
  SYSTEM_ROLE_KEYS,
} from '../../lib/permissions';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const permissionMatrixSchema = z
  .record(
    z.enum(PERMISSION_RESOURCES),
    z.record(z.enum(PERMISSION_ACTIONS), z.boolean()).optional()
  )
  .default({});

const createRoleSchema = z.object({
  key: z.string().min(2).max(60).regex(/^[a-z][a-z0-9_]*$/, 'snake_case vereist'),
  label: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  inherits_from: z
    .enum(SYSTEM_ROLE_KEYS as [string, ...string[]])
    .nullable()
    .optional(),
  permissions: permissionMatrixSchema,
  is_default: z.boolean().optional(),
});

const updateRoleSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  inherits_from: z
    .enum(SYSTEM_ROLE_KEYS as [string, ...string[]])
    .nullable()
    .optional(),
  permissions: permissionMatrixSchema.optional(),
  is_default: z.boolean().optional(),
});

const assignBodySchema = z.object({
  role_key: z.string().min(2).max(60),
  expires_at: z
    .string()
    .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Ongeldige datum')
    .optional(),
});

const securitySettingsPatchSchema = z.object({
  ip_allowlist: z.array(z.string().min(3).max(64)).max(200).optional(),
  ip_allowlist_enforced: z.boolean().optional(),
  session_timeout_minutes: z.number().int().min(5).max(60 * 24 * 30).optional(),
  password_min_length: z.number().int().min(8).max(128).optional(),
  password_require_special: z.boolean().optional(),
  password_max_age_days: z.number().int().min(1).max(3650).nullable().optional(),
  failed_login_lockout_threshold: z.number().int().min(1).max(50).optional(),
  failed_login_lockout_minutes: z.number().int().min(1).max(60 * 24).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────────────

export async function listRolesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await service.listRoles(req.user!.tenantId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function createRoleHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = createRoleSchema.parse(req.body);
    const data = await service.createCustomRole(
      req.user!.tenantId,
      req.user!.userId,
      {
        key: input.key,
        label: input.label,
        description: input.description,
        inherits_from: input.inherits_from ?? null,
        permissions: input.permissions,
        is_default: input.is_default ?? false,
      },
      auditCtxFromReq(req)
    );
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
}

export async function updateRoleHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = updateRoleSchema.parse(req.body);
    const data = await service.updateCustomRole(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      input,
      auditCtxFromReq(req)
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function deleteRoleHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await service.deleteCustomRole(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User assignments
// ─────────────────────────────────────────────────────────────────────────────

export async function listUserRolesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await service.listUserRoles(req.user!.tenantId, req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function assignRoleHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = assignBodySchema.parse(req.body);
    const data = await service.assignRoleToUser(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id,
      input.role_key,
      input.expires_at ? new Date(input.expires_at) : null,
      auditCtxFromReq(req)
    );
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
}

export async function unassignRoleHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await service.unassignRole(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Security settings
// ─────────────────────────────────────────────────────────────────────────────

export async function getSecuritySettingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await service.getSecuritySettings(req.user!.tenantId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function updateSecuritySettingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = securitySettingsPatchSchema.parse(req.body);
    const data = await service.updateSecuritySettings(
      req.user!.tenantId,
      req.user!.userId,
      input,
      auditCtxFromReq(req)
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Current user permission-matrix (frontend bootstrap)
// ─────────────────────────────────────────────────────────────────────────────

export async function getMyPermissionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const matrix = await getCurrentPermissionMatrix(req);
    res.json({
      data: {
        user_id: req.user!.userId,
        tenant_id: req.user!.tenantId,
        matrix: matrix ?? {},
      },
    });
  } catch (err) {
    next(err);
  }
}

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
import { getClientIp } from '../../middleware/ipAllowlist';
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

// Frontend-contract (apps/web/lib/types/security.ts → SecuritySettings).
// ip_allowlist is FULL REPLACEMENT en accepteert zowel plain CIDR-strings
// (zoals useSecurity.ts ze PATCHt) als IpAllowlistEntry-objecten.
const cidrStringSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[0-9a-fA-F:./]+$/, 'Ongeldig IP/CIDR-formaat');

const ipAllowlistEntrySchema = z.union([
  cidrStringSchema,
  z.object({
    cidr: cidrStringSchema,
    label: z.string().max(120).optional(),
  }),
]);

const passwordPolicyPatchSchema = z.object({
  min_length: z.number().int().min(8).max(128).optional(),
  require_uppercase: z.boolean().optional(),
  require_lowercase: z.boolean().optional(),
  require_number: z.boolean().optional(),
  require_symbol: z.boolean().optional(),
  rotation_days: z.number().int().min(1).max(3650).nullable().optional(),
});

const securitySettingsPatchSchema = z.object({
  ip_allowlist: z.array(ipAllowlistEntrySchema).max(200).optional(),
  ip_allowlist_enabled: z.boolean().optional(),
  session_idle_timeout_minutes: z.number().int().min(5).max(60 * 24 * 30).optional(),
  password_policy: passwordPolicyPatchSchema.optional(),
});

const ipVerifyBodySchema = z.object({
  ip: cidrStringSchema,
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
    // Frontend verwacht het SecuritySettings-object direct (geen {data}-wrap).
    const data = await service.getSecuritySettingsView(req.user!.tenantId);
    res.json(data);
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
    const patch: service.UpdateSecuritySettingsViewInput = {};
    if (input.ip_allowlist !== undefined) {
      patch.ip_allowlist = input.ip_allowlist.map((e) =>
        typeof e === 'string'
          ? { cidr: e }
          : { cidr: e.cidr, ...(e.label !== undefined ? { label: e.label } : {}) }
      );
    }
    if (input.ip_allowlist_enabled !== undefined) {
      patch.ip_allowlist_enabled = input.ip_allowlist_enabled;
    }
    if (input.session_idle_timeout_minutes !== undefined) {
      patch.session_idle_timeout_minutes = input.session_idle_timeout_minutes;
    }
    if (input.password_policy !== undefined) {
      patch.password_policy = input.password_policy;
    }
    const data = await service.updateSecuritySettingsView(
      req.user!.tenantId,
      req.user!.userId,
      patch,
      auditCtxFromReq(req)
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/security/ip-verify — check een opgegeven IP tegen de
 * opgeslagen allowlist. Hergebruikt de CIDR-matchlogica van de
 * enforceIpAllowlist-middleware.
 */
export async function verifyIpHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { ip } = ipVerifyBodySchema.parse(req.body);
    const data = await service.verifyIpAgainstAllowlist(req.user!.tenantId, ip);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/security/current-ip — het IP waarmee de admin nu verbonden
 * is (trust proxy staat aan, dus req.ip is X-Forwarded-For-aware).
 */
export async function currentIpHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.json({ ip: getClientIp(req) ?? '' });
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

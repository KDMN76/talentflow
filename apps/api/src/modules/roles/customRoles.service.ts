/**
 * Custom roles service — Sprint Q4.2 (Agent OOO).
 *
 * CRUD voor `tenant_custom_roles` + multi-role assignment-management op
 * `user_role_assignments`. Schrijft audit-events naar `audit_events` voor
 * elke mutatie.
 *
 * Concept:
 *   - System rollen (SYSTEM_ROLES) zijn read-only en bestaan virtueel —
 *     ze worden door listRoles() gemerged in het response zodat de UI
 *     één lijst krijgt.
 *   - Custom rollen leven in `tenant_custom_roles` per tenant. UNIQUE op
 *     (tenant_id, key) met snake_case-key.
 *   - Assignments koppelen users aan rollen. Een user kan meerdere
 *     rollen hebben — permissions worden gemerged in
 *     buildPermissionMatrixForUser().
 *
 * Delete-protectie: een custom rol mag alleen verwijderd worden als geen
 * (niet-verlopen) user_role_assignments er meer naar verwijzen. Vermijdt
 * "ghost"-permissies en cascading user-deactivation.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import {
  SYSTEM_ROLES,
  SYSTEM_ROLE_KEYS,
  type PermissionMatrix,
} from '../../lib/permissions';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RoleSummary {
  key: string;
  label: string;
  description: string | null;
  is_system: boolean;
  is_default: boolean;
  inherits_from: string | null;
  permissions: PermissionMatrix;
  // Extra metadata voor UI (alleen custom-rollen)
  id?: string;
  created_at?: string;
  updated_at?: string;
  user_count?: number;
}

export interface CreateCustomRoleInput {
  key: string;
  label: string;
  description?: string;
  inherits_from?: string | null;
  permissions: PermissionMatrix;
  is_default?: boolean;
}

export interface UpdateCustomRoleInput {
  label?: string;
  description?: string | null;
  inherits_from?: string | null;
  permissions?: PermissionMatrix;
  is_default?: boolean;
}

export interface UserRoleAssignment {
  id: string;
  tenant_id: string;
  user_id: string;
  role_id: string | null;
  role_key: string;
  role_label: string;
  is_system: boolean;
  assigned_at: string;
  assigned_by: string | null;
  expires_at: string | null;
}

interface CustomRoleRow {
  id: string;
  tenant_id: string;
  key: string;
  label: string;
  description: string | null;
  permissions: PermissionMatrix;
  inherits_from: string | null;
  is_system: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;

function validateRoleKey(key: string): void {
  if (!SNAKE_CASE_RE.test(key)) {
    throw new AppError(
      400,
      'INVALID_ROLE_KEY',
      'Rol-key moet snake_case zijn (lowercase, cijfers, underscores)'
    );
  }
  if (SYSTEM_ROLE_KEYS.includes(key)) {
    throw new AppError(
      409,
      'ROLE_KEY_RESERVED',
      `Rol-key '${key}' is gereserveerd voor system-rollen`
    );
  }
}

function validateInheritsFrom(inheritsFrom: string | null | undefined): void {
  if (inheritsFrom == null) return;
  if (!SYSTEM_ROLE_KEYS.includes(inheritsFrom)) {
    throw new AppError(
      400,
      'INVALID_INHERITS_FROM',
      `inherits_from moet een system-rol zijn (${SYSTEM_ROLE_KEYS.join(', ')})`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read helpers
// ─────────────────────────────────────────────────────────────────────────────

function systemRoleToSummary(key: string): RoleSummary {
  const def = SYSTEM_ROLES[key];
  return {
    key: def.key,
    label: def.label,
    description: def.description,
    is_system: true,
    is_default: false,
    inherits_from: null,
    permissions: def.permissions,
  };
}

function customRowToSummary(row: CustomRoleRow, userCount = 0): RoleSummary {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    is_system: row.is_system,
    is_default: row.is_default,
    inherits_from: row.inherits_from,
    permissions: row.permissions ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    user_count: userCount,
  };
}

/**
 * Lijst alle rollen (system + custom) voor de tenant. Custom-rollen krijgen
 * een `user_count` mee — handig voor de UI om te tonen "5 users" naast de
 * delete-knop.
 */
export async function listRoles(tenantId: string): Promise<RoleSummary[]> {
  return withTenant(tenantId, async (client) => {
    const { rows: customRows } = await client.query<CustomRoleRow>(
      `SELECT * FROM tenant_custom_roles
        WHERE tenant_id = $1
        ORDER BY created_at ASC`,
      [tenantId]
    );

    const { rows: countRows } = await client.query<{
      role_id: string | null;
      role_key: string;
      cnt: string;
    }>(
      `SELECT role_id, role_key, COUNT(*) AS cnt
         FROM user_role_assignments
        WHERE tenant_id = $1
          AND (expires_at IS NULL OR expires_at > now())
        GROUP BY role_id, role_key`,
      [tenantId]
    );
    const customCounts = new Map<string, number>();
    const systemCounts = new Map<string, number>();
    for (const r of countRows) {
      const n = parseInt(r.cnt, 10) || 0;
      if (r.role_id) customCounts.set(r.role_id, n);
      else systemCounts.set(r.role_key, n);
    }

    const systemSummaries = SYSTEM_ROLE_KEYS.map((k) => {
      const s = systemRoleToSummary(k);
      s.user_count = systemCounts.get(k) ?? 0;
      return s;
    });

    const customSummaries = customRows.map((r) =>
      customRowToSummary(r, customCounts.get(r.id) ?? 0)
    );

    return [...systemSummaries, ...customSummaries];
  });
}

/**
 * Haal één rol op (system OF custom) per key. Throwt 404 als niet bestaand.
 */
export async function getRole(
  tenantId: string,
  roleKey: string
): Promise<RoleSummary> {
  if (SYSTEM_ROLE_KEYS.includes(roleKey)) {
    return systemRoleToSummary(roleKey);
  }
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<CustomRoleRow>(
      `SELECT * FROM tenant_custom_roles
        WHERE tenant_id = $1 AND key = $2
        LIMIT 1`,
      [tenantId, roleKey]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'ROLE_NOT_FOUND', `Rol '${roleKey}' niet gevonden`);
    }
    return customRowToSummary(rows[0]);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / update / delete custom rol
// ─────────────────────────────────────────────────────────────────────────────

export async function createCustomRole(
  tenantId: string,
  userId: string | null,
  input: CreateCustomRoleInput,
  ctx: AuditContext = {}
): Promise<RoleSummary> {
  validateRoleKey(input.key);
  validateInheritsFrom(input.inherits_from ?? null);

  return withTenant(tenantId, async (client) => {
    // Pre-check: key must be unique. UNIQUE-constraint ondersteund maar we
    // willen een mooie 409 ipv generieke pg-error.
    const { rows: existing } = await client.query(
      `SELECT id FROM tenant_custom_roles
        WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
      [tenantId, input.key]
    );
    if (existing.length > 0) {
      throw new AppError(
        409,
        'ROLE_KEY_EXISTS',
        `Rol-key '${input.key}' bestaat al voor deze tenant`
      );
    }

    // Als is_default=true, eerst andere defaults uitschakelen (één default).
    if (input.is_default) {
      await client.query(
        `UPDATE tenant_custom_roles
            SET is_default = FALSE
          WHERE tenant_id = $1 AND is_default = TRUE`,
        [tenantId]
      );
    }

    const { rows } = await client.query<CustomRoleRow>(
      `INSERT INTO tenant_custom_roles
         (tenant_id, key, label, description, permissions,
          inherits_from, is_system, is_default, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, FALSE, $7, $8)
       RETURNING *`,
      [
        tenantId,
        input.key,
        input.label,
        input.description ?? null,
        JSON.stringify(input.permissions ?? {}),
        input.inherits_from ?? null,
        input.is_default ?? false,
        userId,
      ]
    );
    const created = rows[0];
    await logAudit(
      client,
      tenantId,
      {
        action: 'custom_role.created',
        entityType: 'custom_role',
        entityId: created.id,
        after: created,
        userId,
      },
      ctx
    );
    return customRowToSummary(created);
  });
}

export async function updateCustomRole(
  tenantId: string,
  roleId: string,
  userId: string | null,
  patch: UpdateCustomRoleInput,
  ctx: AuditContext = {}
): Promise<RoleSummary> {
  if (patch.inherits_from !== undefined) {
    validateInheritsFrom(patch.inherits_from);
  }

  return withTenant(tenantId, async (client) => {
    const { rows: existingRows } = await client.query<CustomRoleRow>(
      `SELECT * FROM tenant_custom_roles
        WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, roleId]
    );
    if (existingRows.length === 0) {
      throw new AppError(404, 'ROLE_NOT_FOUND', 'Custom rol niet gevonden');
    }
    const existing = existingRows[0];
    if (existing.is_system) {
      throw new AppError(
        403,
        'SYSTEM_ROLE_IMMUTABLE',
        'System-rollen kunnen niet gewijzigd worden'
      );
    }

    // Default-flag — handhaaf "max 1 default per tenant" invariant.
    if (patch.is_default === true) {
      await client.query(
        `UPDATE tenant_custom_roles
            SET is_default = FALSE
          WHERE tenant_id = $1 AND is_default = TRUE AND id <> $2`,
        [tenantId, roleId]
      );
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (patch.label !== undefined) {
      fields.push(`label = $${idx++}`);
      values.push(patch.label);
    }
    if (patch.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(patch.description);
    }
    if (patch.inherits_from !== undefined) {
      fields.push(`inherits_from = $${idx++}`);
      values.push(patch.inherits_from);
    }
    if (patch.permissions !== undefined) {
      fields.push(`permissions = $${idx++}::jsonb`);
      values.push(JSON.stringify(patch.permissions));
    }
    if (patch.is_default !== undefined) {
      fields.push(`is_default = $${idx++}`);
      values.push(patch.is_default);
    }
    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }
    values.push(tenantId, roleId);

    const { rows } = await client.query<CustomRoleRow>(
      `UPDATE tenant_custom_roles
          SET ${fields.join(', ')}
        WHERE tenant_id = $${idx++} AND id = $${idx}
        RETURNING *`,
      values
    );
    const updated = rows[0];
    await logAudit(
      client,
      tenantId,
      {
        action: 'custom_role.updated',
        entityType: 'custom_role',
        entityId: roleId,
        before: existing,
        after: updated,
        userId,
      },
      ctx
    );
    return customRowToSummary(updated);
  });
}

export async function deleteCustomRole(
  tenantId: string,
  roleId: string,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<CustomRoleRow>(
      `SELECT * FROM tenant_custom_roles
        WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, roleId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'ROLE_NOT_FOUND', 'Custom rol niet gevonden');
    }
    const existing = rows[0];

    // Block delete als er nog (niet-verlopen) assignments zijn.
    const { rows: assigned } = await client.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt
         FROM user_role_assignments
        WHERE tenant_id = $1
          AND role_id = $2
          AND (expires_at IS NULL OR expires_at > now())`,
      [tenantId, roleId]
    );
    const inUse = parseInt(assigned[0]?.cnt ?? '0', 10);
    if (inUse > 0) {
      throw new AppError(
        409,
        'ROLE_IN_USE',
        `Kan rol niet verwijderen — nog ${inUse} actieve toewijzing(en).`,
        { user_count: inUse }
      );
    }

    await client.query(
      `DELETE FROM tenant_custom_roles
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, roleId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'custom_role.deleted',
        entityType: 'custom_role',
        entityId: roleId,
        before: existing,
        userId,
      },
      ctx
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Assignments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assign role (system OF custom, by key) aan een target user. Idempotent —
 * dubbele assignment levert 409.
 */
export async function assignRoleToUser(
  tenantId: string,
  assignedBy: string | null,
  targetUserId: string,
  roleKey: string,
  expiresAt: Date | null = null,
  ctx: AuditContext = {}
): Promise<UserRoleAssignment> {
  return withTenant(tenantId, async (client) => {
    // Verify user bestaat
    const { rows: userRows } = await client.query(
      `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [targetUserId, tenantId]
    );
    if (userRows.length === 0) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User niet gevonden');
    }

    // Resolveer role_id (custom) OF system-rol
    let roleId: string | null = null;
    let roleLabel = roleKey;
    let isSystem = false;
    if (SYSTEM_ROLE_KEYS.includes(roleKey)) {
      isSystem = true;
      roleLabel = SYSTEM_ROLES[roleKey].label;
    } else {
      const { rows: roleRows } = await client.query<CustomRoleRow>(
        `SELECT * FROM tenant_custom_roles
          WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
        [tenantId, roleKey]
      );
      if (roleRows.length === 0) {
        throw new AppError(
          404,
          'ROLE_NOT_FOUND',
          `Rol '${roleKey}' niet gevonden`
        );
      }
      roleId = roleRows[0].id;
      roleLabel = roleRows[0].label;
    }

    try {
      const { rows } = await client.query<{
        id: string;
        tenant_id: string;
        user_id: string;
        role_id: string | null;
        role_key: string;
        assigned_at: string;
        assigned_by: string | null;
        expires_at: string | null;
      }>(
        `INSERT INTO user_role_assignments
           (tenant_id, user_id, role_id, role_key, assigned_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, targetUserId, roleId, roleKey, assignedBy, expiresAt]
      );
      const created = rows[0];
      await logAudit(
        client,
        tenantId,
        {
          action: 'role_assignment.created',
          entityType: 'role_assignment',
          entityId: created.id,
          after: { ...created, target_user_id: targetUserId, role_key: roleKey },
          userId: assignedBy,
        },
        ctx
      );
      return {
        ...created,
        role_label: roleLabel,
        is_system: isSystem,
      };
    } catch (err: unknown) {
      // Unique-constraint violation
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        throw new AppError(
          409,
          'ROLE_ALREADY_ASSIGNED',
          'Deze rol is al aan deze gebruiker toegewezen'
        );
      }
      throw err;
    }
  });
}

export async function unassignRole(
  tenantId: string,
  assignmentId: string,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM user_role_assignments
        WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, assignmentId]
    );
    if (rows.length === 0) {
      throw new AppError(
        404,
        'ASSIGNMENT_NOT_FOUND',
        'Rol-toewijzing niet gevonden'
      );
    }
    const before = rows[0];

    await client.query(
      `DELETE FROM user_role_assignments
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, assignmentId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'role_assignment.deleted',
        entityType: 'role_assignment',
        entityId: assignmentId,
        before,
        userId,
      },
      ctx
    );
  });
}

/**
 * Lijst alle (niet-verlopen) rol-assignments voor een user. Inclusief
 * label van de rol (system OR custom).
 */
export async function listUserRoles(
  tenantId: string,
  targetUserId: string
): Promise<UserRoleAssignment[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      tenant_id: string;
      user_id: string;
      role_id: string | null;
      role_key: string;
      assigned_at: string;
      assigned_by: string | null;
      expires_at: string | null;
      custom_label: string | null;
    }>(
      `SELECT a.*, r.label AS custom_label
         FROM user_role_assignments a
         LEFT JOIN tenant_custom_roles r ON r.id = a.role_id
        WHERE a.tenant_id = $1
          AND a.user_id = $2
          AND (a.expires_at IS NULL OR a.expires_at > now())
        ORDER BY a.assigned_at DESC`,
      [tenantId, targetUserId]
    );
    return rows.map((r) => {
      const isSystem = r.role_id === null;
      const label = isSystem
        ? SYSTEM_ROLES[r.role_key]?.label ?? r.role_key
        : r.custom_label ?? r.role_key;
      return {
        id: r.id,
        tenant_id: r.tenant_id,
        user_id: r.user_id,
        role_id: r.role_id,
        role_key: r.role_key,
        role_label: label,
        is_system: isSystem,
        assigned_at: r.assigned_at,
        assigned_by: r.assigned_by,
        expires_at: r.expires_at,
      };
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Security settings (IP-allowlist + password policy)
// ─────────────────────────────────────────────────────────────────────────────

export interface SecuritySettings {
  tenant_id: string;
  ip_allowlist: string[];
  ip_allowlist_enforced: boolean;
  session_timeout_minutes: number;
  password_min_length: number;
  password_require_special: boolean;
  password_max_age_days: number | null;
  failed_login_lockout_threshold: number;
  failed_login_lockout_minutes: number;
  created_at: string;
  updated_at: string;
}

export async function getSecuritySettings(
  tenantId: string,
  client?: PoolClient
): Promise<SecuritySettings> {
  const run = async (c: PoolClient): Promise<SecuritySettings> => {
    const { rows } = await c.query<SecuritySettings>(
      `SELECT * FROM tenant_security_settings WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    if (rows.length > 0) return rows[0];
    // Lazy-create row met defaults
    const { rows: created } = await c.query<SecuritySettings>(
      `INSERT INTO tenant_security_settings (tenant_id)
       VALUES ($1)
       ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
       RETURNING *`,
      [tenantId]
    );
    return created[0];
  };
  if (client) return run(client);
  return withTenant(tenantId, run);
}

export interface UpdateSecuritySettingsInput {
  ip_allowlist?: string[];
  ip_allowlist_enforced?: boolean;
  session_timeout_minutes?: number;
  password_min_length?: number;
  password_require_special?: boolean;
  password_max_age_days?: number | null;
  failed_login_lockout_threshold?: number;
  failed_login_lockout_minutes?: number;
}

export async function updateSecuritySettings(
  tenantId: string,
  userId: string | null,
  patch: UpdateSecuritySettingsInput,
  ctx: AuditContext = {}
): Promise<SecuritySettings> {
  return withTenant(tenantId, async (client) => {
    // Lazy-init de rij eerst
    const before = await getSecuritySettings(tenantId, client);

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const set = <K extends keyof UpdateSecuritySettingsInput>(
      column: string,
      val: UpdateSecuritySettingsInput[K]
    ): void => {
      fields.push(`${column} = $${idx++}`);
      values.push(val);
    };
    if (patch.ip_allowlist !== undefined) set('ip_allowlist', patch.ip_allowlist);
    if (patch.ip_allowlist_enforced !== undefined)
      set('ip_allowlist_enforced', patch.ip_allowlist_enforced);
    if (patch.session_timeout_minutes !== undefined)
      set('session_timeout_minutes', patch.session_timeout_minutes);
    if (patch.password_min_length !== undefined)
      set('password_min_length', patch.password_min_length);
    if (patch.password_require_special !== undefined)
      set('password_require_special', patch.password_require_special);
    if (patch.password_max_age_days !== undefined)
      set('password_max_age_days', patch.password_max_age_days);
    if (patch.failed_login_lockout_threshold !== undefined)
      set('failed_login_lockout_threshold', patch.failed_login_lockout_threshold);
    if (patch.failed_login_lockout_minutes !== undefined)
      set('failed_login_lockout_minutes', patch.failed_login_lockout_minutes);

    if (fields.length === 0) return before;
    values.push(tenantId);

    const { rows } = await client.query<SecuritySettings>(
      `UPDATE tenant_security_settings
          SET ${fields.join(', ')}
        WHERE tenant_id = $${idx}
        RETURNING *`,
      values
    );
    const updated = rows[0];

    await logAudit(
      client,
      tenantId,
      {
        action: 'security_settings.updated',
        entityType: 'security_settings',
        entityId: tenantId,
        before,
        after: updated,
        userId,
      },
      ctx
    );

    return updated;
  });
}

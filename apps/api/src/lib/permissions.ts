/**
 * Permission-matrix definitie + system-rollen + merge-logic.
 *
 * Sprint Q4.2 (Agent OOO).
 *
 * Filosofie: een tenant-admin moet kunnen zeggen "deze user mag candidates
 * lezen+schrijven, jobs alleen lezen, billing helemaal niet". Dat doen we via
 * een 2D permission-matrix:
 *
 *   resource (candidates / jobs / billing / ...)  ×  action (read / write / delete / admin)
 *
 * Default-deny: een ontbrekende key betekent FALSE. We gebruiken Partial<>
 * zodat de wire-format compact blijft (alleen TRUE-keys hoeven gestuurd).
 *
 * SYSTEM_ROLES bevat de built-in rollen. Custom-rollen erven via
 * `inherits_from` (single-level — geen recursive inheritance om cyclische
 * graphs en debug-pijn te vermijden). De service-laag mergt:
 *
 *     final = OR(inherits_from-permissions, custom-permissions)
 *
 * `userHasPermission` doet de feitelijke check — een user kan meerdere rollen
 * hebben, dan wordt het OR over alle role-matrices genomen (most-permissive
 * wins, zoals AWS IAM allow + AD-groups).
 */

import { withTenant } from '../db/pool';

// ─────────────────────────────────────────────────────────────────────────────
// Resources & actions
// ─────────────────────────────────────────────────────────────────────────────

export const PERMISSION_RESOURCES = [
  'candidates',
  'jobs',
  'applications',
  'communications',
  'workflows',
  'reports',
  'interviews',
  'crm',
  'portal',
  'career_pages',
  'job_boards',
  'hiring_managers',
  'users',
  'billing',
  'integrations',
  'webhooks',
  'audit',
  'compliance',
  'custom_fields',
  'saved_searches',
] as const;

export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

export const PERMISSION_ACTIONS = ['read', 'write', 'delete', 'admin'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * Wire-format. Alle ontbrekende keys = FALSE (default-deny). Voorbeeld:
 *
 *   { candidates: { read: true, write: true }, jobs: { read: true } }
 */
export type PermissionMatrix = Partial<
  Record<PermissionResource, Partial<Record<PermissionAction, boolean>>>
>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — full-true / read-only matrix builders
// ─────────────────────────────────────────────────────────────────────────────

function fullAccessMatrix(): PermissionMatrix {
  const m: PermissionMatrix = {};
  for (const r of PERMISSION_RESOURCES) {
    m[r] = { read: true, write: true, delete: true, admin: true };
  }
  return m;
}

function readOnlyMatrix(): PermissionMatrix {
  const m: PermissionMatrix = {};
  for (const r of PERMISSION_RESOURCES) {
    m[r] = { read: true, write: false, delete: false, admin: false };
  }
  return m;
}

/**
 * Admin = full access behalve `users:admin` (user-management vereist
 * super_admin). Op deze manier kan een tenant-admin alle business-data
 * beheren, maar niet zelf rollen of users buiten de eigen scope reshufflen
 * zonder owner/super_admin-recht.
 */
function adminMatrix(): PermissionMatrix {
  const m = fullAccessMatrix();
  m.users = { read: true, write: true, delete: false, admin: false };
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM_ROLES
// ─────────────────────────────────────────────────────────────────────────────

export interface SystemRoleDefinition {
  key: string;
  label: string;
  description: string;
  permissions: PermissionMatrix;
}

/**
 * Built-in rollen. Worden in `listRoles` mee-opgeleverd zodat de UI ze
 * normaal kan tonen. `is_system: true` blokkeert wijzigen/verwijderen op
 * controller-niveau.
 */
export const SYSTEM_ROLES: Record<string, SystemRoleDefinition> = {
  // 'owner' is de rol van de tenant-aanmaker (zie auth.service.ts register()).
  // Overal in de codebase staat al `requireRole('admin', 'owner')` als de
  // bedoelde "boven admin"-rol voor security-settings en custom-role-beheer,
  // maar er bestond tot nu toe geen SYSTEM_ROLES-entry voor 'owner' — dat
  // maakte requirePermission(...)-checks (o.a. 'users','admin' voor
  // custom-role CRUD) onbereikbaar voor ELKE user, want
  // buildPermissionMatrixForUser() valt terug op SYSTEM_ROLES[users.role] en
  // vond daar niets voor 'owner'. Volledige toegang, inclusief users:admin —
  // in tegenstelling tot 'admin' (zie adminMatrix hieronder).
  owner: {
    key: 'owner',
    label: 'Owner',
    description: 'Tenant-eigenaar (aanmaker). Volledige toegang inclusief user-/rolbeheer.',
    permissions: fullAccessMatrix(),
  },
  super_admin: {
    key: 'super_admin',
    label: 'Super Admin',
    description: 'Volledige toegang inclusief user-management.',
    permissions: fullAccessMatrix(),
  },
  admin: {
    key: 'admin',
    label: 'Admin',
    description: 'Tenant-administrator. Beheert business-data, niet users:admin.',
    permissions: adminMatrix(),
  },
  recruiter: {
    key: 'recruiter',
    label: 'Recruiter',
    description: 'Beheert kandidaten, vacatures, applicaties en communicatie.',
    permissions: {
      candidates: { read: true, write: true },
      jobs: { read: true, write: true },
      applications: { read: true, write: true },
      communications: { read: true, write: true },
      workflows: { read: true },
      reports: { read: true },
      interviews: { read: true, write: true },
      crm: { read: true, write: true },
      hiring_managers: { read: true, write: true },
      career_pages: { read: true },
      job_boards: { read: true, write: true },
      // Eigen opgeslagen zoekopdrachten zijn een persoonlijk gemak-feature,
      // geen tenant-brede config — elke rol die mag zoeken mag ook bewaren.
      saved_searches: { read: true, write: true },
    },
  },
  hiring_manager: {
    key: 'hiring_manager',
    label: 'Hiring Manager',
    description: 'Bekijkt kandidaten en geeft feedback op applicaties.',
    permissions: {
      candidates: { read: true },
      applications: { read: true, write: true },
      jobs: { read: true },
      interviews: { read: true, write: true },
      saved_searches: { read: true, write: true },
    },
  },
  viewer: {
    key: 'viewer',
    label: 'Viewer',
    description: 'Alleen-lezen toegang voor analisten / observers.',
    permissions: readOnlyMatrix(),
  },
};

export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES) as readonly string[];

// ─────────────────────────────────────────────────────────────────────────────
// Permission-merge helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge twee matrices met OR-logic — elke (resource, action) is TRUE als
 * één van beide TRUE is. Default-deny voor ontbrekende keys.
 */
export function mergePermissions(
  a: PermissionMatrix,
  b: PermissionMatrix
): PermissionMatrix {
  const out: PermissionMatrix = {};
  const resources = new Set<PermissionResource>([
    ...(Object.keys(a) as PermissionResource[]),
    ...(Object.keys(b) as PermissionResource[]),
  ]);
  for (const r of resources) {
    const aPerms = a[r] ?? {};
    const bPerms = b[r] ?? {};
    const merged: Partial<Record<PermissionAction, boolean>> = {};
    const actions = new Set<PermissionAction>([
      ...(Object.keys(aPerms) as PermissionAction[]),
      ...(Object.keys(bPerms) as PermissionAction[]),
    ]);
    for (const act of actions) {
      merged[act] = !!(aPerms[act] || bPerms[act]);
    }
    out[r] = merged;
  }
  return out;
}

/**
 * Resolveer een rij uit `tenant_custom_roles` naar een effective matrix
 * door inherits_from (system-role) te mergen met de eigen permissions.
 */
export function resolveCustomRolePermissions(
  row: { permissions: PermissionMatrix; inherits_from: string | null }
): PermissionMatrix {
  const ownPerms = row.permissions ?? {};
  if (!row.inherits_from) return ownPerms;
  const base = SYSTEM_ROLES[row.inherits_from];
  if (!base) return ownPerms; // unknown system-role → ignore inheritance
  return mergePermissions(base.permissions, ownPerms);
}

/**
 * Zoek een SYSTEM_ROLE-definitie via key. Returned `null` als de key niet
 * bestaat (custom-rol bv).
 */
export function getSystemRole(key: string): SystemRoleDefinition | null {
  return SYSTEM_ROLES[key] ?? null;
}

/**
 * Permission-check. Accepteert meerdere matrices (multi-role) en doet
 * effectief OR over alle. Returned TRUE zodra één matrix de (resource, action)
 * grant.
 *
 * Speciale shortcut: als één matrix `<resource>:admin === true` heeft, dan
 * impliceert dat read+write+delete voor diezelfde resource. Dit voorkomt dat
 * een admin-rol ALLE acties expliciet hoeft te listen.
 */
export function userHasPermission(
  matrices: PermissionMatrix[],
  resource: string,
  action: string
): boolean {
  for (const m of matrices) {
    const perms = m[resource as PermissionResource];
    if (!perms) continue;
    if (perms.admin) return true; // admin implies all actions on this resource
    if (perms[action as PermissionAction]) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build permission-matrix voor een user (uit de DB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combineer:
 *   1) De `users.role`-default (legacy single-role kolom).
 *   2) Alle rij-en in `user_role_assignments` (system OF custom, niet
 *      verlopen).
 *
 * Als een user géén assignments heeft, valt-ie terug op `users.role` (zodat
 * bestaande tenants vóór deze migratie blijven werken).
 *
 * Custom-rol permissies worden geresolved met `resolveCustomRolePermissions`
 * (dwz inherits_from wordt eerst gemerged).
 */
export async function buildPermissionMatrixForUser(
  tenantId: string,
  userId: string
): Promise<PermissionMatrix> {
  return withTenant(tenantId, async (client) => {
    // 1) Haal users.role + assignments op. NIET via Promise.all op dezelfde
    // client: één pg-client kan maar één query tegelijk uitvoeren, dus
    // parallelle queries op dezelfde client worden geserialiseerd én geven
    // `DeprecationWarning: Calling client.query() when the client is already
    // executing a query`. Sequentieel awaiten levert exact hetzelfde resultaat
    // zonder de warning (dit pad draait op vrijwel elke geautoriseerde request).
    const { rows: userRows } = await client.query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );
    const { rows: assignmentRows } = await client.query<{
      role_id: string | null;
      role_key: string;
      permissions: PermissionMatrix | null;
      inherits_from: string | null;
    }>(
      `SELECT a.role_id, a.role_key,
              r.permissions, r.inherits_from
         FROM user_role_assignments a
         LEFT JOIN tenant_custom_roles r ON r.id = a.role_id
        WHERE a.tenant_id = $1
          AND a.user_id = $2
          AND (a.expires_at IS NULL OR a.expires_at > now())`,
      [tenantId, userId]
    );

    let combined: PermissionMatrix = {};

    // 2) Legacy users.role als baseline
    if (userRows.length > 0) {
      const legacyRoleKey = userRows[0].role;
      const legacy = SYSTEM_ROLES[legacyRoleKey];
      if (legacy) combined = legacy.permissions;
    }

    // 3) Stack assignments
    for (const a of assignmentRows) {
      if (a.role_id) {
        // Custom rol — resolve inherits_from + own perms
        const resolved = resolveCustomRolePermissions({
          permissions: a.permissions ?? {},
          inherits_from: a.inherits_from,
        });
        combined = mergePermissions(combined, resolved);
      } else {
        // System rol via role_key
        const sys = SYSTEM_ROLES[a.role_key];
        if (sys) combined = mergePermissions(combined, sys.permissions);
      }
    }

    return combined;
  });
}

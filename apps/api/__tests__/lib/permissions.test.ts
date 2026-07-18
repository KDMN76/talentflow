/**
 * Permission-matrix tests — Sprint Q4.2.
 *
 * Test:
 *   - userHasPermission OR-logic over meerdere matrices
 *   - admin-implies-all op resource-niveau
 *   - default-deny voor ontbrekende keys
 *   - mergePermissions OR-logic
 *   - resolveCustomRolePermissions inheritance van system → custom
 *   - SYSTEM_ROLES sanity-check (recruiter/viewer matrices)
 */

import { describe, it, expect } from 'vitest';
import {
  userHasPermission,
  mergePermissions,
  resolveCustomRolePermissions,
  SYSTEM_ROLES,
  PERMISSION_RESOURCES,
  type PermissionMatrix,
} from '../../src/lib/permissions';

describe('userHasPermission', () => {
  it('returns false on empty matrix-list (default-deny)', () => {
    expect(userHasPermission([], 'candidates', 'read')).toBe(false);
  });

  it('returns false when resource missing (default-deny)', () => {
    const m: PermissionMatrix = { jobs: { read: true } };
    expect(userHasPermission([m], 'candidates', 'read')).toBe(false);
  });

  it('returns true when single matrix grants explicit action', () => {
    const m: PermissionMatrix = { candidates: { read: true } };
    expect(userHasPermission([m], 'candidates', 'read')).toBe(true);
  });

  it('returns false when explicit action is false', () => {
    const m: PermissionMatrix = { candidates: { read: false, write: true } };
    expect(userHasPermission([m], 'candidates', 'read')).toBe(false);
  });

  it('OR-merges across multiple matrices (most-permissive wins)', () => {
    const a: PermissionMatrix = { candidates: { read: true } };
    const b: PermissionMatrix = { candidates: { write: true } };
    expect(userHasPermission([a, b], 'candidates', 'write')).toBe(true);
    expect(userHasPermission([a, b], 'candidates', 'read')).toBe(true);
    expect(userHasPermission([a, b], 'candidates', 'delete')).toBe(false);
  });

  it('admin:true on a resource implies all sub-actions', () => {
    const m: PermissionMatrix = { jobs: { admin: true } };
    expect(userHasPermission([m], 'jobs', 'read')).toBe(true);
    expect(userHasPermission([m], 'jobs', 'write')).toBe(true);
    expect(userHasPermission([m], 'jobs', 'delete')).toBe(true);
    // admin implies admin obviously
    expect(userHasPermission([m], 'jobs', 'admin')).toBe(true);
    // but not other resources
    expect(userHasPermission([m], 'candidates', 'read')).toBe(false);
  });
});

describe('mergePermissions', () => {
  it('OR-merges per (resource, action)', () => {
    const a: PermissionMatrix = {
      candidates: { read: true, write: false },
      jobs: { read: true },
    };
    const b: PermissionMatrix = {
      candidates: { write: true, delete: true },
    };
    const merged = mergePermissions(a, b);
    expect(merged.candidates).toEqual({
      read: true,
      write: true,
      delete: true,
    });
    expect(merged.jobs).toEqual({ read: true });
  });

  it('handles disjoint resources', () => {
    const a: PermissionMatrix = { candidates: { read: true } };
    const b: PermissionMatrix = { jobs: { write: true } };
    const merged = mergePermissions(a, b);
    expect(merged.candidates?.read).toBe(true);
    expect(merged.jobs?.write).toBe(true);
  });

  it('does not mutate the input matrices', () => {
    const a: PermissionMatrix = { candidates: { read: true } };
    const b: PermissionMatrix = { candidates: { write: true } };
    mergePermissions(a, b);
    expect(a).toEqual({ candidates: { read: true } });
    expect(b).toEqual({ candidates: { write: true } });
  });
});

describe('resolveCustomRolePermissions', () => {
  it('returns own permissions when no inheritance', () => {
    const own: PermissionMatrix = { candidates: { read: true } };
    const result = resolveCustomRolePermissions({
      permissions: own,
      inherits_from: null,
    });
    expect(result).toEqual(own);
  });

  it('inherits from system-role and merges', () => {
    // Recruiter heeft candidates.read+write, jobs.read+write, etc.
    const result = resolveCustomRolePermissions({
      permissions: { reports: { write: true } },
      inherits_from: 'recruiter',
    });
    // Geërfd:
    expect(result.candidates?.read).toBe(true);
    expect(result.candidates?.write).toBe(true);
    // Eigen:
    expect(result.reports?.write).toBe(true);
    // Niet geërfd door recruiter (billing):
    expect(result.billing?.read).toBeFalsy();
  });

  it('eigen TRUE override eventuele system-FALSE niet', () => {
    // Recruiter heeft geen billing-rechten. Custom-rol grant billing.read.
    const result = resolveCustomRolePermissions({
      permissions: { billing: { read: true } },
      inherits_from: 'recruiter',
    });
    expect(result.billing?.read).toBe(true);
  });

  it('valt terug op own als inherits_from onbekend', () => {
    const result = resolveCustomRolePermissions({
      permissions: { candidates: { read: true } },
      inherits_from: 'galactic_overlord',
    });
    expect(result).toEqual({ candidates: { read: true } });
  });
});

describe('SYSTEM_ROLES sanity', () => {
  it('super_admin heeft full access op alle resources', () => {
    const m = SYSTEM_ROLES.super_admin.permissions;
    for (const r of PERMISSION_RESOURCES) {
      expect(m[r]?.admin).toBe(true);
    }
  });

  it('admin mist users:admin maar heeft de rest', () => {
    const m = SYSTEM_ROLES.admin.permissions;
    expect(m.users?.admin).toBeFalsy();
    expect(m.users?.read).toBe(true);
    expect(m.candidates?.admin).toBe(true);
    expect(m.billing?.admin).toBe(true);
  });

  it('viewer is read-only — geen write/delete', () => {
    const m = SYSTEM_ROLES.viewer.permissions;
    for (const r of PERMISSION_RESOURCES) {
      expect(m[r]?.read).toBe(true);
      expect(m[r]?.write).toBeFalsy();
      expect(m[r]?.delete).toBeFalsy();
    }
  });

  it('hiring_manager heeft minimale set: candidates:read, applications:write', () => {
    const m = SYSTEM_ROLES.hiring_manager.permissions;
    expect(m.candidates?.read).toBe(true);
    expect(m.candidates?.write).toBeFalsy();
    expect(m.applications?.write).toBe(true);
    expect(m.billing?.read).toBeFalsy();
  });

  // Regressietest voor de audit-fix: register() maakt de tenant-aanmaker nu
  // 'owner' i.p.v. 'admin' (zie auth.service.test.ts). Zonder een SYSTEM_ROLES
  // entry voor 'owner' viel buildPermissionMatrixForUser() terug op een lege
  // matrix — dan kon GEEN enkele user requirePermission('users','admin')
  // (custom-role CRUD, roles.router.ts) ooit halen, want 'admin' sluit dat
  // bewust uit en 'owner'/'super_admin' werden nooit toegekend.
  it('owner heeft volledige toegang inclusief users:admin (in tegenstelling tot admin)', () => {
    const m = SYSTEM_ROLES.owner.permissions;
    for (const r of PERMISSION_RESOURCES) {
      expect(m[r]?.admin).toBe(true);
    }
    expect(userHasPermission([m], 'users', 'admin')).toBe(true);
  });
});

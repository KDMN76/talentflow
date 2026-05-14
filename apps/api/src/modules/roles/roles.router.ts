/**
 * Roles router — Sprint Q4.2 (Agent OOO).
 *
 * Mount points (zie index.ts):
 *   - rolesRouter        → /api/roles            (list — alle authed)
 *   - adminRolesRouter   → /api/admin/roles + /api/admin/users/:id/roles
 *                                    + /api/admin/role-assignments + /api/admin/security
 *   - permissionsRouter  → /api/permissions      (current user's matrix)
 *
 * Permission-checks:
 *   - Read endpoints: requirePermission('users','read')
 *   - Write endpoints (rollen, security, assignments): requirePermission('users','admin')
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';
import * as ctrl from './roles.controller';

// ─── /api/roles ─────────────────────────────────────────────────────────────
// Public-binnen-tenant — iedere authenticated user mag de rollenlijst zien
// (handig voor onboarding-formulieren waar je een rol moet kiezen).
export const rolesRouter = Router();
rolesRouter.use(requireAuth, tenantMiddleware);
rolesRouter.get('/', ctrl.listRolesHandler);

// ─── /api/admin/roles ───────────────────────────────────────────────────────
// CRUD op custom-rollen + role-assignments + security settings — admin-only.
export const adminRolesRouter = Router();
adminRolesRouter.use(requireAuth, tenantMiddleware);

// Custom-rollen CRUD
adminRolesRouter.post(
  '/roles',
  requirePermission('users', 'admin'),
  ctrl.createRoleHandler
);
adminRolesRouter.patch(
  '/roles/:id',
  requirePermission('users', 'admin'),
  ctrl.updateRoleHandler
);
adminRolesRouter.delete(
  '/roles/:id',
  requirePermission('users', 'admin'),
  ctrl.deleteRoleHandler
);

// User → role assignments
adminRolesRouter.get(
  '/users/:id/roles',
  requirePermission('users', 'read'),
  ctrl.listUserRolesHandler
);
adminRolesRouter.post(
  '/users/:id/roles',
  requirePermission('users', 'admin'),
  ctrl.assignRoleHandler
);
adminRolesRouter.delete(
  '/role-assignments/:id',
  requirePermission('users', 'admin'),
  ctrl.unassignRoleHandler
);

// Security settings (IP-allowlist, password policy, ...)
adminRolesRouter.get(
  '/security',
  requirePermission('users', 'admin'),
  ctrl.getSecuritySettingsHandler
);
adminRolesRouter.patch(
  '/security',
  requirePermission('users', 'admin'),
  ctrl.updateSecuritySettingsHandler
);

// ─── /api/permissions ───────────────────────────────────────────────────────
// Geeft de huidige user's effective permission-matrix. Frontend gebruikt dit
// om UI-elementen conditioneel te tonen.
export const permissionsRouter = Router();
permissionsRouter.use(requireAuth, tenantMiddleware);
permissionsRouter.get('/', ctrl.getMyPermissionsHandler);

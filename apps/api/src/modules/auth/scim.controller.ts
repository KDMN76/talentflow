/**
 * SCIM 2.0 (RFC 7644) endpoints — Sprint Q4.2 (Agent NNN).
 *
 * Mounted op `/scim/v2/*` — dit is de standaard die Okta/Azure AD/JumpCloud
 * verwachten. Auth via `Authorization: Bearer tflw_scim_…` token; we
 * scannen alle tenant_sso_configs om de matching tenant te vinden.
 *
 * Mappings (TalentFlow ↔ SCIM Core User schema):
 *   - userName            ↔  users.email
 *   - active              ↔  users.is_active / deleted_at
 *   - name.givenName +
 *     name.familyName     ↔  users.name (concat)
 *   - emails[primary]     ↔  users.email
 *   - groups              ↔  users.role (single role; group-name → role)
 *   - externalId          ↔  users.scim_external_id
 *
 * Group-naam → role mapping is config-driven via `attribute_mapping.groups`
 * — als een group "TalentFlow.Admin" heet, kunnen we dat naar `admin`
 * promoten. Default: lowercase group name als role.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PoolClient } from 'pg';
import * as samlService from './saml.service';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

// ────────────────────────────────────────────────────────────────────────────
// SCIM auth middleware
// ────────────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      scimTenantId?: string;
    }
  }
}

async function scimAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new AppError(401, 'SCIM_UNAUTHORIZED', 'Bearer token vereist');
    }
    const token = auth.slice(7);
    const result = await samlService.authenticateScimToken(token);
    if (!result) {
      throw new AppError(401, 'SCIM_INVALID_TOKEN', 'Ongeldige SCIM-token');
    }
    req.scimTenantId = result.tenantId;
    next();
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

interface ScimUserResource {
  schemas: string[];
  id: string;
  externalId?: string | null;
  userName: string;
  name: { givenName?: string; familyName?: string };
  emails: Array<{ value: string; primary: boolean; type: string }>;
  active: boolean;
  groups?: Array<{ value: string; display: string }>;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
    location: string;
  };
}

interface ScimGroupResource {
  schemas: string[];
  id: string; // role-naam
  displayName: string;
  members: Array<{ value: string; display?: string }>;
  meta: {
    resourceType: 'Group';
    location: string;
  };
}

interface UserDbRow {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  deleted_at: Date | null;
  scim_external_id: string | null;
  created_at: Date;
  updated_at?: Date | null;
}

function userRowToScim(row: UserDbRow, tenantId: string): ScimUserResource {
  const [givenName, ...rest] = (row.name ?? '').split(' ');
  const familyName = rest.join(' ');
  const base = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: row.id,
    externalId: row.scim_external_id,
    userName: row.email,
    name: { givenName, familyName },
    emails: [{ value: row.email, primary: true, type: 'work' }],
    active: row.is_active && !row.deleted_at,
    groups: row.role ? [{ value: row.role, display: row.role }] : [],
    meta: {
      resourceType: 'User',
      created: row.created_at.toISOString(),
      lastModified: (row.updated_at ?? row.created_at).toISOString(),
      location: `${base}/scim/v2/Users/${row.id}`,
    },
  };
  // tenantId not part of SCIM payload — tenant-scoping is in the bearer token.
  void tenantId;
}

const scimUserCreateSchema = z.object({
  schemas: z.array(z.string()).optional(),
  externalId: z.string().optional(),
  userName: z.string().email(),
  name: z
    .object({
      givenName: z.string().optional(),
      familyName: z.string().optional(),
      formatted: z.string().optional(),
    })
    .optional(),
  emails: z
    .array(
      z.object({
        value: z.string().email(),
        primary: z.boolean().optional(),
        type: z.string().optional(),
      })
    )
    .optional(),
  active: z.boolean().optional(),
  groups: z
    .array(
      z.object({
        value: z.string(),
        display: z.string().optional(),
      })
    )
    .optional(),
  password: z.string().optional(),
});

function buildName(scim: z.infer<typeof scimUserCreateSchema>): string {
  if (scim.name?.formatted) return scim.name.formatted;
  const parts = [scim.name?.givenName, scim.name?.familyName].filter(Boolean);
  if (parts.length) return parts.join(' ');
  return scim.userName.split('@')[0]!;
}

function pickRole(scim: z.infer<typeof scimUserCreateSchema>, defaultRole: string): string {
  const g = scim.groups?.[0];
  if (!g) return defaultRole;
  const display = (g.display ?? g.value).toLowerCase().trim();
  // Direct match — accepteer canonieke roles
  const known = ['admin', 'owner', 'recruiter', 'hiring_manager', 'viewer'];
  if (known.includes(display)) return display;
  // Strip prefixes als "TalentFlow." of "App-"
  const stripped = display.replace(/^[a-z]+[._-]/i, '');
  if (known.includes(stripped)) return stripped;
  return defaultRole;
}

async function logScim(
  client: PoolClient,
  tenantId: string,
  scimId: string,
  userId: string | null,
  operation: 'create' | 'update' | 'deactivate' | 'delete' | 'patch',
  payload: unknown,
  status: 'success' | 'error' = 'success',
  error?: string
): Promise<void> {
  await client.query(
    `INSERT INTO scim_provisioning_log
       (tenant_id, scim_id, user_id, operation, payload, status, error)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      tenantId,
      scimId,
      userId,
      operation,
      payload === undefined ? null : JSON.stringify(payload),
      status,
      error ?? null,
    ]
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────────────

const router = Router();

// ServiceProviderConfig + ResourceTypes + Schemas — geen auth (RFC 7644 §4)
router.get('/ServiceProviderConfig', (_req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://talentflow.example/docs/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'TalentFlow tenant SCIM bearer token',
        primary: true,
      },
    ],
  });
});

router.get('/ResourceTypes', (_req, res) => {
  const base = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 2,
    Resources: [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
        meta: { location: `${base}/scim/v2/ResourceTypes/User`, resourceType: 'ResourceType' },
      },
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'Group',
        name: 'Group',
        endpoint: '/Groups',
        schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
        meta: { location: `${base}/scim/v2/ResourceTypes/Group`, resourceType: 'ResourceType' },
      },
    ],
  });
});

router.get('/Schemas', (_req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 2,
    Resources: [
      { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User' },
      { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group' },
    ],
  });
});

// Auth-protected endpoints
router.use(scimAuth);

// ── /Users — ListResponse ───────────────────────────────────────────────────

router.get('/Users', async (req, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const startIndex = Math.max(1, parseInt((req.query.startIndex as string) ?? '1', 10));
    const count = Math.min(200, Math.max(0, parseInt((req.query.count as string) ?? '100', 10)));
    const filter = req.query.filter as string | undefined;

    let emailFilter: string | null = null;
    let externalIdFilter: string | null = null;
    if (filter) {
      // RFC 7644 filter — we ondersteunen alleen `userName eq "x"` en
      // `externalId eq "x"`. Voldoende voor 95% van IdP-flows.
      const u = filter.match(/userName\s+eq\s+"([^"]+)"/i);
      if (u) emailFilter = u[1]!.toLowerCase();
      const e = filter.match(/externalId\s+eq\s+"([^"]+)"/i);
      if (e) externalIdFilter = e[1]!;
    }

    const result = await withTenant(tenantId, async (client) => {
      const where: string[] = ['tenant_id = $1', 'deleted_at IS NULL'];
      const params: unknown[] = [tenantId];
      if (emailFilter) {
        params.push(emailFilter);
        where.push(`email = $${params.length}`);
      }
      if (externalIdFilter) {
        params.push(externalIdFilter);
        where.push(`scim_external_id = $${params.length}`);
      }
      const whereSql = where.join(' AND ');

      const { rows: total } = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM users WHERE ${whereSql}`,
        params
      );
      params.push(count);
      params.push(startIndex - 1);
      const { rows } = await client.query<UserDbRow>(
        `SELECT id, email, name, role, is_active, deleted_at, scim_external_id, created_at
           FROM users WHERE ${whereSql}
           ORDER BY created_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return { total: parseInt(total[0]!.c, 10), rows };
    });

    res.json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: result.total,
      startIndex,
      itemsPerPage: result.rows.length,
      Resources: result.rows.map((r) => userRowToScim(r, tenantId)),
    });
  } catch (err) {
    next(err);
  }
});

// ── /Users/:id — GET ────────────────────────────────────────────────────────

router.get('/Users/:id', async (req, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const id = req.params.id!;
    const row = await withTenant(tenantId, async (client) => {
      const { rows } = await client.query<UserDbRow>(
        `SELECT id, email, name, role, is_active, deleted_at, scim_external_id, created_at
           FROM users WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      return rows[0] ?? null;
    });
    if (!row) {
      throw new AppError(404, 'SCIM_USER_NOT_FOUND', 'User niet gevonden');
    }
    res.json(userRowToScim(row, tenantId));
  } catch (err) {
    next(err);
  }
});

// ── /Users — POST (create) ──────────────────────────────────────────────────

router.post('/Users', async (req, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const input = scimUserCreateSchema.parse(req.body);
    const cfg = await samlService.getRawSsoConfig(tenantId);
    const defaultRole = cfg?.default_role ?? 'recruiter';

    const email = (input.emails?.[0]?.value ?? input.userName).toLowerCase();
    const name = buildName(input);
    const role = pickRole(input, defaultRole);
    const externalId = input.externalId ?? null;
    const active = input.active ?? true;

    const created = await withTenant(tenantId, async (client) => {
      // upsert op email — sommige IdPs sturen create voor bestaande user
      const { rows } = await client.query<UserDbRow>(
        `INSERT INTO users (tenant_id, email, name, role, is_active, scim_external_id, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, '')
         ON CONFLICT (tenant_id, email) DO UPDATE
           SET name = EXCLUDED.name,
               role = EXCLUDED.role,
               is_active = EXCLUDED.is_active,
               scim_external_id = COALESCE(EXCLUDED.scim_external_id, users.scim_external_id),
               deleted_at = NULL
         RETURNING id, email, name, role, is_active, deleted_at, scim_external_id, created_at`,
        [tenantId, email, name, role, active, externalId]
      );
      const row = rows[0]!;
      await logScim(client, tenantId, externalId ?? row.id, row.id, 'create', input);
      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.SCIM_USER_CREATED,
          entityType: 'user',
          entityId: row.id,
          after: { email, role, externalId },
        }
      );
      return row;
    });

    res.status(201).json(userRowToScim(created, tenantId));
  } catch (err) {
    next(err);
  }
});

// ── /Users/:id — PUT (full replace) ─────────────────────────────────────────

router.put('/Users/:id', async (req, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const id = req.params.id!;
    const input = scimUserCreateSchema.parse(req.body);
    const cfg = await samlService.getRawSsoConfig(tenantId);
    const defaultRole = cfg?.default_role ?? 'recruiter';

    const email = (input.emails?.[0]?.value ?? input.userName).toLowerCase();
    const name = buildName(input);
    const role = pickRole(input, defaultRole);
    const active = input.active ?? true;

    const updated = await withTenant(tenantId, async (client) => {
      const { rows } = await client.query<UserDbRow>(
        `UPDATE users
            SET email = $1,
                name = $2,
                role = $3,
                is_active = $4,
                scim_external_id = COALESCE($5, scim_external_id),
                deleted_at = CASE WHEN $4 = FALSE THEN now() ELSE NULL END
          WHERE id = $6 AND tenant_id = $7
          RETURNING id, email, name, role, is_active, deleted_at, scim_external_id, created_at`,
        [email, name, role, active, input.externalId ?? null, id, tenantId]
      );
      if (!rows[0]) {
        await logScim(client, tenantId, id, null, 'update', input, 'error', 'not_found');
        throw new AppError(404, 'SCIM_USER_NOT_FOUND', 'User niet gevonden');
      }
      await logScim(client, tenantId, rows[0].scim_external_id ?? id, id, 'update', input);
      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.SCIM_USER_UPDATED,
          entityType: 'user',
          entityId: id,
          after: { email, role, active },
        }
      );
      return rows[0];
    });

    res.json(userRowToScim(updated, tenantId));
  } catch (err) {
    next(err);
  }
});

// ── /Users/:id — PATCH (RFC 7644 patch) ─────────────────────────────────────

const patchSchema = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z.array(
    z.object({
      op: z.enum(['add', 'replace', 'remove', 'Add', 'Replace', 'Remove']),
      path: z.string().optional(),
      value: z.unknown().optional(),
    })
  ),
});

router.patch('/Users/:id', async (req, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const id = req.params.id!;
    const body = patchSchema.parse(req.body);

    const updated = await withTenant(tenantId, async (client) => {
      const { rows: current } = await client.query<UserDbRow>(
        `SELECT id, email, name, role, is_active, deleted_at, scim_external_id, created_at
           FROM users WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (!current[0]) {
        throw new AppError(404, 'SCIM_USER_NOT_FOUND', 'User niet gevonden');
      }
      const row = current[0];
      let { email, name, role, is_active } = row;

      for (const opRaw of body.Operations) {
        const op = opRaw.op.toLowerCase();
        const path = opRaw.path?.toLowerCase();
        const v = opRaw.value;

        if (op === 'replace' || op === 'add') {
          if (path === 'active') {
            is_active = !!v;
          } else if (path === 'username') {
            if (typeof v === 'string') email = v.toLowerCase();
          } else if (path === 'name.givenname') {
            const fam = (name ?? '').split(' ').slice(1).join(' ');
            if (typeof v === 'string') name = `${v} ${fam}`.trim();
          } else if (path === 'name.familyname') {
            const giv = (name ?? '').split(' ')[0] ?? '';
            if (typeof v === 'string') name = `${giv} ${v}`.trim();
          } else if (!path && typeof v === 'object' && v !== null) {
            // Bulk-replace zonder path — IdPs als Azure AD doen dit
            const obj = v as Record<string, unknown>;
            if (typeof obj.active === 'boolean') is_active = obj.active;
            if (typeof obj.userName === 'string') email = obj.userName.toLowerCase();
            if (typeof obj.displayName === 'string') name = obj.displayName;
            if (
              obj.name &&
              typeof obj.name === 'object' &&
              obj.name !== null
            ) {
              const n = obj.name as { givenName?: string; familyName?: string };
              const giv = n.givenName ?? (name ?? '').split(' ')[0] ?? '';
              const fam = n.familyName ?? (name ?? '').split(' ').slice(1).join(' ');
              name = `${giv} ${fam}`.trim();
            }
          }
        }
      }

      const { rows: updatedRows } = await client.query<UserDbRow>(
        `UPDATE users
            SET email = $1, name = $2, role = $3, is_active = $4,
                deleted_at = CASE WHEN $4 = FALSE THEN now() ELSE NULL END
          WHERE id = $5 AND tenant_id = $6
          RETURNING id, email, name, role, is_active, deleted_at, scim_external_id, created_at`,
        [email, name, role, is_active, id, tenantId]
      );

      const action = is_active ? 'patch' : 'deactivate';
      await logScim(client, tenantId, row.scim_external_id ?? id, id, action, body);
      await logAudit(
        client,
        tenantId,
        {
          action: is_active
            ? AuditActions.SCIM_USER_UPDATED
            : AuditActions.SCIM_USER_DEACTIVATED,
          entityType: 'user',
          entityId: id,
          after: { email, name, role, is_active },
        }
      );
      return updatedRows[0]!;
    });

    res.json(userRowToScim(updated, tenantId));
  } catch (err) {
    next(err);
  }
});

// ── /Users/:id — DELETE ─────────────────────────────────────────────────────

router.delete('/Users/:id', async (req, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const id = req.params.id!;

    await withTenant(tenantId, async (client) => {
      const { rows } = await client.query<{ id: string; scim_external_id: string | null }>(
        `UPDATE users
            SET deleted_at = now(), is_active = FALSE
          WHERE id = $1 AND tenant_id = $2
          RETURNING id, scim_external_id`,
        [id, tenantId]
      );
      if (!rows[0]) {
        throw new AppError(404, 'SCIM_USER_NOT_FOUND', 'User niet gevonden');
      }
      await logScim(client, tenantId, rows[0].scim_external_id ?? id, id, 'delete', null);
      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.SCIM_USER_DELETED,
          entityType: 'user',
          entityId: id,
        }
      );
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Groups — TalentFlow heeft één role per user; we exposen roles als groups
// ────────────────────────────────────────────────────────────────────────────

const KNOWN_ROLES = ['admin', 'owner', 'recruiter', 'hiring_manager', 'viewer'];

router.get('/Groups', async (req, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const base = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';

    const groups = await withTenant(tenantId, async (client) => {
      const { rows } = await client.query<{ role: string; member_id: string; member_name: string }>(
        `SELECT role,
                id::text AS member_id,
                COALESCE(name, email) AS member_name
           FROM users
          WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId]
      );
      const byRole = new Map<string, ScimGroupResource>();
      for (const role of KNOWN_ROLES) {
        byRole.set(role, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          id: role,
          displayName: role,
          members: [],
          meta: {
            resourceType: 'Group',
            location: `${base}/scim/v2/Groups/${role}`,
          },
        });
      }
      for (const r of rows) {
        const g = byRole.get(r.role);
        if (g) g.members.push({ value: r.member_id, display: r.member_name });
      }
      return [...byRole.values()];
    });

    res.json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: groups.length,
      startIndex: 1,
      itemsPerPage: groups.length,
      Resources: groups,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/Groups/:id', async (req, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const role = req.params.id!.toLowerCase();
    if (!KNOWN_ROLES.includes(role)) {
      throw new AppError(404, 'SCIM_GROUP_NOT_FOUND', 'Group niet gevonden');
    }
    const base = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';

    const group = await withTenant(tenantId, async (client) => {
      const { rows } = await client.query<{ id: string; name: string; email: string }>(
        `SELECT id::text, COALESCE(name, '') AS name, email
           FROM users
          WHERE tenant_id = $1 AND role = $2 AND deleted_at IS NULL`,
        [tenantId, role]
      );
      return {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        id: role,
        displayName: role,
        members: rows.map((r) => ({
          value: r.id,
          display: r.name || r.email,
        })),
        meta: {
          resourceType: 'Group' as const,
          location: `${base}/scim/v2/Groups/${role}`,
        },
      };
    });
    res.json(group);
  } catch (err) {
    next(err);
  }
});

router.post('/Groups', (_req, res) => {
  // Groups in TalentFlow zijn immutable canonieke roles. Een POST /Groups
  // van de IdP wordt geaccepteerd maar slaat niets op — we returnen de
  // bestaande role als die matcht, anders 409.
  res.status(409).json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    detail: 'Groups in TalentFlow zijn vaste roles — beheer is read-only.',
    status: '409',
  });
});

router.patch('/Groups/:id', async (req, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const role = req.params.id!.toLowerCase();
    if (!KNOWN_ROLES.includes(role)) {
      throw new AppError(404, 'SCIM_GROUP_NOT_FOUND', 'Group niet gevonden');
    }
    const body = patchSchema.parse(req.body);

    await withTenant(tenantId, async (client) => {
      for (const opRaw of body.Operations) {
        const op = opRaw.op.toLowerCase();
        // path zoals `members[value eq "<userId>"]` ondersteunen we vereenvoudigd.
        const path = opRaw.path ?? '';
        const v = opRaw.value;

        if (op === 'add' && Array.isArray(v)) {
          for (const m of v) {
            const userId = (m as { value?: string }).value;
            if (userId) {
              await client.query(
                'UPDATE users SET role = $1 WHERE id = $2 AND tenant_id = $3',
                [role, userId, tenantId]
              );
            }
          }
        } else if (op === 'remove') {
          const m = path.match(/members\[value\s+eq\s+"([^"]+)"\]/i);
          if (m) {
            // Bij remove zetten we op default-role i.p.v. niets — een user
            // zonder role kan niets in TalentFlow.
            const cfg = await samlService.getRawSsoConfig(tenantId);
            const def = cfg?.default_role ?? 'recruiter';
            await client.query(
              'UPDATE users SET role = $1 WHERE id = $2 AND tenant_id = $3',
              [def, m[1]!, tenantId]
            );
          }
        }
      }

      await logScim(client, tenantId, role, null, 'patch', body);
      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.SCIM_GROUP_UPDATED,
          entityType: 'group',
          entityId: null,
          after: { role, ops: body.Operations.length },
        }
      );
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;

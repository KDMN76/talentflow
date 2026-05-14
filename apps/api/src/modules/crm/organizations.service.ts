import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';

export interface OrganizationListFilter {
  search?: string;
  type?: 'client' | 'prospect' | 'partner';
}

export interface OrganizationCreateData {
  name: string;
  industry?: string | null;
  website?: string | null;
  notes?: string | null;
  type?: 'client' | 'prospect' | 'partner';
}

export interface OrganizationUpdateData {
  name?: string;
  industry?: string | null;
  website?: string | null;
  notes?: string | null;
  type?: 'client' | 'prospect' | 'partner';
}

/**
 * If the underlying table does not yet exist (during dev / before migrations
 * are applied) we want to degrade gracefully instead of returning a 500.
 * Postgres throws SQLSTATE 42P01 ("undefined_table") in that case.
 */
function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '42P01';
}

export async function listOrganizations(
  tenantId: string,
  filter: OrganizationListFilter = {}
) {
  try {
    return await withTenant(tenantId, async (client) => {
      const conditions: string[] = [`tenant_id = $1`, `deleted_at IS NULL`];
      const values: unknown[] = [tenantId];
      let idx = 2;

      if (filter.search) {
        conditions.push(`(name ILIKE $${idx} OR industry ILIKE $${idx})`);
        values.push(`%${filter.search}%`);
        idx++;
      }

      if (filter.type) {
        conditions.push(`type = $${idx++}`);
        values.push(filter.type);
      }

      const where = conditions.join(' AND ');

      const { rows } = await client.query(
        `SELECT id, tenant_id, name, industry, website, notes, type, created_at
         FROM organizations
         WHERE ${where}
         ORDER BY created_at DESC`,
        values
      );

      return rows;
    });
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function getOrganization(tenantId: string, id: string) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [org] } = await client.query(
        `SELECT id, tenant_id, name, industry, website, notes, type, created_at
         FROM organizations
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [id, tenantId]
      );

      if (!org) {
        throw new AppError(404, 'ORGANIZATION_NOT_FOUND', 'Organisatie niet gevonden');
      }

      return org;
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(404, 'ORGANIZATION_NOT_FOUND', 'Organisatie niet gevonden');
    }
    throw err;
  }
}

export async function createOrganization(
  tenantId: string,
  _userId: string,
  data: OrganizationCreateData
) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [org] } = await client.query(
        `INSERT INTO organizations (tenant_id, name, industry, website, notes, type)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, tenant_id, name, industry, website, notes, type, created_at`,
        [
          tenantId,
          data.name,
          data.industry ?? null,
          data.website ?? null,
          data.notes ?? null,
          data.type ?? 'prospect',
        ]
      );
      return org;
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(
        503,
        'CRM_NOT_PROVISIONED',
        'CRM-tabellen zijn nog niet beschikbaar'
      );
    }
    throw err;
  }
}

export async function updateOrganization(
  tenantId: string,
  id: string,
  _userId: string,
  data: OrganizationUpdateData
) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [existing] } = await client.query(
        `SELECT id FROM organizations WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [id, tenantId]
      );
      if (!existing) {
        throw new AppError(404, 'ORGANIZATION_NOT_FOUND', 'Organisatie niet gevonden');
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      const mappable = ['name', 'industry', 'website', 'notes', 'type'] as const;
      for (const key of mappable) {
        if (data[key] !== undefined) {
          fields.push(`${key} = $${idx++}`);
          values.push(data[key]);
        }
      }

      if (fields.length === 0) {
        throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
      }

      values.push(id, tenantId);

      const { rows: [org] } = await client.query(
        `UPDATE organizations SET ${fields.join(', ')}
         WHERE id = $${idx++} AND tenant_id = $${idx}
         RETURNING id, tenant_id, name, industry, website, notes, type, created_at`,
        values
      );

      return org;
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(404, 'ORGANIZATION_NOT_FOUND', 'Organisatie niet gevonden');
    }
    throw err;
  }
}

export async function deleteOrganization(tenantId: string, id: string): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      const { rows: [org] } = await client.query(
        `UPDATE organizations SET deleted_at = now()
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [id, tenantId]
      );

      if (!org) {
        throw new AppError(404, 'ORGANIZATION_NOT_FOUND', 'Organisatie niet gevonden');
      }
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(404, 'ORGANIZATION_NOT_FOUND', 'Organisatie niet gevonden');
    }
    throw err;
  }
}

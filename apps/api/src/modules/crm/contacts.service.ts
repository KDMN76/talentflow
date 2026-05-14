import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';

export interface ContactCreateData {
  organization_id?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  linkedin_url?: string | null;
  notes?: string | null;
}

export interface ContactUpdateData {
  organization_id?: string | null;
  name?: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  linkedin_url?: string | null;
  notes?: string | null;
}

function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '42P01';
}

export async function listContacts(tenantId: string, organizationId?: string) {
  try {
    return await withTenant(tenantId, async (client) => {
      const conditions: string[] = [`c.tenant_id = $1`];
      const values: unknown[] = [tenantId];
      let idx = 2;

      if (organizationId) {
        conditions.push(`c.organization_id = $${idx++}`);
        values.push(organizationId);
      }

      const where = conditions.join(' AND ');

      const { rows } = await client.query(
        `SELECT c.id, c.tenant_id, c.organization_id, c.name, c.email, c.phone, c.role,
                c.linkedin_url, c.notes, c.created_at,
                o.name as organization_name
         FROM crm_contacts c
         LEFT JOIN organizations o ON o.id = c.organization_id AND o.tenant_id = c.tenant_id
         WHERE ${where}
         ORDER BY c.created_at DESC`,
        values
      );

      return rows;
    });
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function getContact(tenantId: string, id: string) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [contact] } = await client.query(
        `SELECT c.id, c.tenant_id, c.organization_id, c.name, c.email, c.phone, c.role,
                c.linkedin_url, c.notes, c.created_at,
                o.name as organization_name
         FROM crm_contacts c
         LEFT JOIN organizations o ON o.id = c.organization_id AND o.tenant_id = c.tenant_id
         WHERE c.id = $1 AND c.tenant_id = $2`,
        [id, tenantId]
      );

      if (!contact) {
        throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contactpersoon niet gevonden');
      }

      return contact;
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contactpersoon niet gevonden');
    }
    throw err;
  }
}

export async function createContact(
  tenantId: string,
  _userId: string,
  data: ContactCreateData
) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [contact] } = await client.query(
        `INSERT INTO crm_contacts (tenant_id, organization_id, name, email, phone, role, linkedin_url, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         RETURNING *`,
        [
          tenantId,
          data.organization_id ?? null,
          data.name,
          data.email ?? null,
          data.phone ?? null,
          data.role ?? null,
          data.linkedin_url ?? null,
          data.notes ?? null,
        ]
      );
      return contact;
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(503, 'CRM_NOT_PROVISIONED', 'CRM-tabellen zijn nog niet beschikbaar');
    }
    throw err;
  }
}

export async function updateContact(
  tenantId: string,
  id: string,
  _userId: string,
  data: ContactUpdateData
) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [existing] } = await client.query(
        `SELECT id FROM crm_contacts WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (!existing) {
        throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contactpersoon niet gevonden');
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      const mappable = ['organization_id', 'name', 'email', 'phone', 'role', 'linkedin_url', 'notes'] as const;
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

      const { rows: [contact] } = await client.query(
        `UPDATE crm_contacts SET ${fields.join(', ')}
         WHERE id = $${idx++} AND tenant_id = $${idx}
         RETURNING *`,
        values
      );

      return contact;
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contactpersoon niet gevonden');
    }
    throw err;
  }
}

export async function deleteContact(tenantId: string, id: string): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      const { rows: [contact] } = await client.query(
        `DELETE FROM crm_contacts WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );

      if (!contact) {
        throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contactpersoon niet gevonden');
      }
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contactpersoon niet gevonden');
    }
    throw err;
  }
}

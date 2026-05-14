import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';

export async function getTenant(tenantId: string) {
  return withoutTenant(async (client) => {
    const { rows: [tenant] } = await client.query(
      `SELECT id, name, slug, plan, settings, created_at FROM tenants WHERE id = $1`,
      [tenantId]
    );
    if (!tenant) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant niet gevonden');
    }
    return tenant;
  });
}

export async function updateTenant(
  tenantId: string,
  data: { name?: string; settings?: Record<string, unknown> }
) {
  return withTenant(tenantId, async (client) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.settings !== undefined) {
      fields.push(`settings = $${idx++}`);
      values.push(JSON.stringify(data.settings));
    }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    values.push(tenantId);

    const { rows: [tenant] } = await client.query(
      `UPDATE tenants SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, name, slug, plan, settings`,
      values
    );

    if (!tenant) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant niet gevonden');
    }

    return tenant;
  });
}

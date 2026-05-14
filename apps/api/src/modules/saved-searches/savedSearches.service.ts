/**
 * Saved searches — opgeslagen Boolean-zoekopdrachten per gebruiker.
 *
 * RLS-veilig via withTenant. Eén gebruiker mag meerdere searches met dezelfde
 * naam hebben (geen UNIQUE) — UI kan ze ontdubbelen of suffixen.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { parseBoolean } from '../../lib/booleanSearch';

export type SavedSearchEntity = 'candidates' | 'jobs';

export interface SavedSearchRow {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  query_text: string;
  filters: Record<string, unknown>;
  entity_type: SavedSearchEntity;
  created_at: string;
  updated_at: string;
}

export interface CreateSavedSearchInput {
  name: string;
  query_text: string;
  filters?: Record<string, unknown>;
  entity_type: SavedSearchEntity;
}

export async function listSavedSearches(
  tenantId: string,
  userId: string,
  entityType?: SavedSearchEntity
): Promise<SavedSearchRow[]> {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId, userId];
    let where = `tenant_id = $1 AND user_id = $2`;
    if (entityType) {
      params.push(entityType);
      where += ` AND entity_type = $${params.length}`;
    }
    const { rows } = await client.query(
      `SELECT id, tenant_id, user_id, name, query_text, filters, entity_type,
              created_at, updated_at
       FROM saved_searches
       WHERE ${where}
       ORDER BY updated_at DESC`,
      params
    );
    return rows as SavedSearchRow[];
  });
}

export async function getSavedSearch(
  tenantId: string,
  userId: string,
  id: string
): Promise<SavedSearchRow> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM saved_searches
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
      [id, tenantId, userId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Opgeslagen zoekopdracht niet gevonden');
    }
    return rows[0] as SavedSearchRow;
  });
}

export async function createSavedSearch(
  tenantId: string,
  userId: string,
  input: CreateSavedSearchInput,
  ctx: AuditContext = {}
): Promise<SavedSearchRow> {
  // Validate query_text by attempting to parse — fail-fast bij syntactisch
  // ongeldige queries zodat ze niet als 'opgeslagen' worden gepresenteerd.
  try {
    parseBoolean(input.query_text);
  } catch (err) {
    throw new AppError(
      400,
      'INVALID_BOOLEAN_QUERY',
      `Ongeldige Boolean query: ${(err as Error).message}`
    );
  }

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO saved_searches
         (tenant_id, user_id, name, query_text, filters, entity_type)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING *`,
      [
        tenantId,
        userId,
        input.name,
        input.query_text,
        JSON.stringify(input.filters ?? {}),
        input.entity_type,
      ]
    );
    const row = rows[0] as SavedSearchRow;

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.SAVED_SEARCH_CREATED,
        entityType: 'saved_search',
        entityId: row.id,
        after: { name: row.name, entity_type: row.entity_type },
        userId,
      },
      ctx
    );

    return row;
  });
}

export async function updateSavedSearch(
  tenantId: string,
  userId: string,
  id: string,
  input: Partial<CreateSavedSearchInput>
): Promise<SavedSearchRow> {
  if (input.query_text !== undefined) {
    try {
      parseBoolean(input.query_text);
    } catch (err) {
      throw new AppError(
        400,
        'INVALID_BOOLEAN_QUERY',
        `Ongeldige Boolean query: ${(err as Error).message}`
      );
    }
  }

  return withTenant(tenantId, async (client) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(input.name);
    }
    if (input.query_text !== undefined) {
      fields.push(`query_text = $${idx++}`);
      values.push(input.query_text);
    }
    if (input.filters !== undefined) {
      fields.push(`filters = $${idx++}::jsonb`);
      values.push(JSON.stringify(input.filters));
    }
    if (input.entity_type !== undefined) {
      fields.push(`entity_type = $${idx++}`);
      values.push(input.entity_type);
    }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    fields.push(`updated_at = now()`);
    values.push(id, tenantId, userId);

    const { rows } = await client.query(
      `UPDATE saved_searches SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx++} AND user_id = $${idx}
       RETURNING *`,
      values
    );
    if (rows.length === 0) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Opgeslagen zoekopdracht niet gevonden');
    }
    return rows[0] as SavedSearchRow;
  });
}

export async function deleteSavedSearch(
  tenantId: string,
  userId: string,
  id: string,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `DELETE FROM saved_searches
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3
       RETURNING id, name`,
      [id, tenantId, userId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Opgeslagen zoekopdracht niet gevonden');
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.SAVED_SEARCH_DELETED,
        entityType: 'saved_search',
        entityId: id,
        before: rows[0],
        userId,
      },
      ctx
    );
  });
}

/**
 * Custom Fields engine — generic EAV-store voor per-tenant custom velden.
 *
 * Twee tabellen:
 *   - custom_field_definitions  (per tenant+entity_type+key)
 *   - custom_field_values       (per definition_id+entity_id)
 *
 * Validation gebeurt service-side: type-coercie + required + dropdown-options.
 * RLS-veilig via withTenant; alle UPSERTs lopen in een enkele transactie zodat
 * partiële writes nooit zichtbaar worden.
 */

import { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type CustomFieldEntity = 'candidate' | 'job' | 'application';

export type CustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'multiselect'
  | 'boolean';

export interface CustomFieldOption {
  value: string;
  label: string;
}

export interface CustomFieldDefinition {
  id: string;
  tenant_id: string;
  entity_type: CustomFieldEntity;
  key: string;
  label: string;
  field_type: CustomFieldType;
  options: CustomFieldOption[];
  required: boolean;
  position: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateFieldInput {
  entity_type: CustomFieldEntity;
  key: string;
  label: string;
  field_type: CustomFieldType;
  options?: CustomFieldOption[];
  required?: boolean;
  position?: number;
}

export type UpdateFieldInput = Partial<
  Omit<CreateFieldInput, 'entity_type' | 'key'>
>;

export interface CustomFieldValidationError {
  key: string;
  message: string;
}

export interface CustomFieldValidationResult {
  valid: boolean;
  errors: CustomFieldValidationError[];
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

// ────────────────────────────────────────────────────────────────────────────
// Validation (pure)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validates a {key: value} payload against an array of definitions. Used
 * before persisting via setValuesForEntity. Pure — no DB access.
 */
export function validateValues(
  definitions: CustomFieldDefinition[],
  values: Record<string, unknown>
): CustomFieldValidationResult {
  const errors: CustomFieldValidationError[] = [];
  const byKey = new Map(definitions.map((d) => [d.key, d]));

  // Validate provided keys
  for (const [key, value] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) {
      errors.push({ key, message: `Onbekend custom field '${key}'` });
      continue;
    }
    const err = validateSingle(def, value);
    if (err) errors.push({ key, message: err });
  }

  // Required-checks for missing keys
  for (const def of definitions) {
    if (!def.required) continue;
    if (!(def.key in values) || values[def.key] === null || values[def.key] === undefined) {
      errors.push({ key: def.key, message: `Veld '${def.label}' is verplicht` });
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateSingle(def: CustomFieldDefinition, value: unknown): string | null {
  if (value === null || value === undefined) return null; // null is wis-actie
  switch (def.field_type) {
    case 'text': {
      if (typeof value !== 'string') return `Veld '${def.label}' verwacht tekst`;
      return null;
    }
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return `Veld '${def.label}' verwacht getal`;
      }
      return null;
    }
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
        return `Veld '${def.label}' verwacht ISO-datum (YYYY-MM-DD)`;
      }
      return null;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return `Veld '${def.label}' verwacht boolean`;
      return null;
    }
    case 'dropdown': {
      if (typeof value !== 'string') return `Veld '${def.label}' verwacht string`;
      const ok = (def.options ?? []).some((o) => o.value === value);
      if (!ok) return `Waarde '${value}' niet toegestaan voor veld '${def.label}'`;
      return null;
    }
    case 'multiselect': {
      if (!Array.isArray(value)) return `Veld '${def.label}' verwacht array`;
      const allowed = new Set((def.options ?? []).map((o) => o.value));
      for (const v of value) {
        if (typeof v !== 'string' || !allowed.has(v)) {
          return `Waarde '${String(v)}' niet toegestaan voor veld '${def.label}'`;
        }
      }
      return null;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CRUD on definitions
// ────────────────────────────────────────────────────────────────────────────

function rowToDefinition(row: Record<string, unknown>): CustomFieldDefinition {
  return {
    ...(row as unknown as CustomFieldDefinition),
    options: parseOptions(row.options),
  };
}

function parseOptions(raw: unknown): CustomFieldOption[] {
  if (Array.isArray(raw)) return raw as CustomFieldOption[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function listFields(
  tenantId: string,
  entityType?: CustomFieldEntity
): Promise<CustomFieldDefinition[]> {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    let where = `tenant_id = $1 AND deleted_at IS NULL`;
    if (entityType) {
      params.push(entityType);
      where += ` AND entity_type = $${params.length}`;
    }
    const { rows } = await client.query(
      `SELECT id, tenant_id, entity_type, key, label, field_type, options,
              required, position, deleted_at, created_at, updated_at
       FROM custom_field_definitions
       WHERE ${where}
       ORDER BY entity_type, position ASC, label ASC`,
      params
    );
    return rows.map(rowToDefinition);
  });
}

export async function getField(
  tenantId: string,
  id: string
): Promise<CustomFieldDefinition> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM custom_field_definitions
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'CUSTOM_FIELD_NOT_FOUND', 'Custom field niet gevonden');
    }
    return rowToDefinition(rows[0]);
  });
}

export async function createField(
  tenantId: string,
  userId: string,
  input: CreateFieldInput,
  ctx: AuditContext = {}
): Promise<CustomFieldDefinition> {
  if (!KEY_PATTERN.test(input.key)) {
    throw new AppError(
      400,
      'INVALID_KEY',
      `Custom-field key moet snake_case zijn (a-z, 0-9, _) en starten met een letter. Kreeg: '${input.key}'`
    );
  }
  if (
    (input.field_type === 'dropdown' || input.field_type === 'multiselect') &&
    (!input.options || input.options.length === 0)
  ) {
    throw new AppError(
      400,
      'OPTIONS_REQUIRED',
      `Field-type '${input.field_type}' vereist minimaal één optie`
    );
  }

  return withTenant(tenantId, async (client) => {
    try {
      const { rows } = await client.query(
        `INSERT INTO custom_field_definitions
           (tenant_id, entity_type, key, label, field_type, options, required, position)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         RETURNING *`,
        [
          tenantId,
          input.entity_type,
          input.key,
          input.label,
          input.field_type,
          JSON.stringify(input.options ?? []),
          input.required ?? false,
          input.position ?? 0,
        ]
      );
      const def = rowToDefinition(rows[0]);

      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.CUSTOM_FIELD_CREATED,
          entityType: 'custom_field',
          entityId: def.id,
          after: { entity_type: def.entity_type, key: def.key, field_type: def.field_type },
          userId,
        },
        ctx
      );

      return def;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === '23505') {
        throw new AppError(
          409,
          'DUPLICATE_KEY',
          `Custom field '${input.key}' bestaat al voor ${input.entity_type}`
        );
      }
      throw err;
    }
  });
}

export async function updateField(
  tenantId: string,
  userId: string,
  id: string,
  input: UpdateFieldInput,
  ctx: AuditContext = {}
): Promise<CustomFieldDefinition> {
  return withTenant(tenantId, async (client) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.label !== undefined) {
      fields.push(`label = $${idx++}`);
      values.push(input.label);
    }
    if (input.field_type !== undefined) {
      fields.push(`field_type = $${idx++}`);
      values.push(input.field_type);
    }
    if (input.options !== undefined) {
      fields.push(`options = $${idx++}::jsonb`);
      values.push(JSON.stringify(input.options));
    }
    if (input.required !== undefined) {
      fields.push(`required = $${idx++}`);
      values.push(input.required);
    }
    if (input.position !== undefined) {
      fields.push(`position = $${idx++}`);
      values.push(input.position);
    }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    fields.push(`updated_at = now()`);
    values.push(id, tenantId);

    const { rows } = await client.query(
      `UPDATE custom_field_definitions SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx} AND deleted_at IS NULL
       RETURNING *`,
      values
    );
    if (rows.length === 0) {
      throw new AppError(404, 'CUSTOM_FIELD_NOT_FOUND', 'Custom field niet gevonden');
    }

    const def = rowToDefinition(rows[0]);
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.CUSTOM_FIELD_UPDATED,
        entityType: 'custom_field',
        entityId: id,
        after: { key: def.key },
        userId,
      },
      ctx
    );
    return def;
  });
}

export async function deleteField(
  tenantId: string,
  userId: string,
  id: string,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `UPDATE custom_field_definitions
       SET deleted_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id, key, entity_type`,
      [id, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'CUSTOM_FIELD_NOT_FOUND', 'Custom field niet gevonden');
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.CUSTOM_FIELD_DELETED,
        entityType: 'custom_field',
        entityId: id,
        before: rows[0],
        userId,
      },
      ctx
    );
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Values
// ────────────────────────────────────────────────────────────────────────────

/**
 * Hydrate alle custom-field values voor één entity. Returned een
 * `key → value` object — eenvoudig consumeerbaar voor de frontend en voor
 * de candidates/jobs response-body.
 */
export async function getValuesForEntity(
  tenantId: string,
  entityType: CustomFieldEntity,
  entityId: string
): Promise<Record<string, unknown>> {
  return withTenant(tenantId, async (client) => {
    return getValuesForEntityInClient(client, tenantId, entityType, entityId);
  });
}

/**
 * Same as `getValuesForEntity` but uses an existing client — useful when
 * the caller is already inside a withTenant transaction.
 */
export async function getValuesForEntityInClient(
  client: PoolClient,
  tenantId: string,
  entityType: CustomFieldEntity,
  entityId: string
): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `SELECT d.key, v.value
     FROM custom_field_values v
     JOIN custom_field_definitions d ON d.id = v.definition_id
     WHERE v.tenant_id = $1
       AND v.entity_type = $2
       AND v.entity_id = $3
       AND d.deleted_at IS NULL`,
    [tenantId, entityType, entityId]
  );
  const out: Record<string, unknown> = {};
  for (const r of rows as Array<{ key: string; value: unknown }>) {
    out[r.key] = r.value;
  }
  return out;
}

/**
 * Set/update/clear meerdere values in één transactie. Validatie eerst —
 * één invalid value blokkeert de hele write zodat het record consistent blijft.
 */
export async function setValuesForEntity(
  tenantId: string,
  userId: string,
  entityType: CustomFieldEntity,
  entityId: string,
  values: Record<string, unknown>,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    // Load active definitions for this entity-type
    const { rows: defRows } = await client.query(
      `SELECT id, tenant_id, entity_type, key, label, field_type, options,
              required, position, deleted_at, created_at, updated_at
       FROM custom_field_definitions
       WHERE tenant_id = $1 AND entity_type = $2 AND deleted_at IS NULL`,
      [tenantId, entityType]
    );
    const definitions = defRows.map(rowToDefinition);
    const byKey = new Map(definitions.map((d) => [d.key, d]));

    const result = validateValues(definitions, values);
    if (!result.valid) {
      throw new AppError(400, 'CUSTOM_FIELDS_INVALID', 'Custom-fields validatie mislukt', {
        errors: result.errors,
      });
    }

    // Upsert per key
    for (const [key, value] of Object.entries(values)) {
      const def = byKey.get(key);
      if (!def) continue; // already validated above
      if (value === null || value === undefined) {
        // null = wis
        await client.query(
          `DELETE FROM custom_field_values
           WHERE tenant_id = $1 AND definition_id = $2 AND entity_id = $3`,
          [tenantId, def.id, entityId]
        );
        continue;
      }

      await client.query(
        `INSERT INTO custom_field_values
           (tenant_id, definition_id, entity_type, entity_id, value)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (definition_id, entity_id)
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [tenantId, def.id, entityType, entityId, JSON.stringify(value)]
      );
    }

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.CUSTOM_FIELD_VALUES_SET,
        entityType,
        entityId,
        after: { keys: Object.keys(values) },
        userId,
      },
      ctx
    );
  });
}

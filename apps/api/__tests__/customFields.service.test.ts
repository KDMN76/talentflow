import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';
import {
  createField,
  updateField,
  deleteField,
  listFields,
  getField,
  validateValues,
  setValuesForEntity,
  getValuesForEntity,
  type CustomFieldDefinition,
} from '../src/modules/custom-fields/customFields.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function defStub(overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    tenant_id: TENANT_ID,
    entity_type: 'candidate',
    key: 'salary_band',
    label: 'Salary Band',
    field_type: 'dropdown',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
    required: false,
    position: 0,
    deleted_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// validateValues (pure)
// ────────────────────────────────────────────────────────────────────────────

describe('validateValues — pure validation', () => {
  it('passes when all values match field definitions', () => {
    const defs = [
      defStub({ field_type: 'text', key: 'note', options: [] }),
      defStub({ field_type: 'number', key: 'score', options: [] }),
    ];
    const r = validateValues(defs, { note: 'hi', score: 4 });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('flags wrong type for text field', () => {
    const defs = [defStub({ field_type: 'text', key: 'note', options: [] })];
    const r = validateValues(defs, { note: 123 });
    expect(r.valid).toBe(false);
    expect(r.errors[0].key).toBe('note');
  });

  it('rejects dropdown value not in options', () => {
    const defs = [defStub()]; // dropdown a/b
    const r = validateValues(defs, { salary_band: 'c' });
    expect(r.valid).toBe(false);
  });

  it('accepts dropdown value in options', () => {
    const defs = [defStub()];
    const r = validateValues(defs, { salary_band: 'b' });
    expect(r.valid).toBe(true);
  });

  it('rejects multiselect value with unknown member', () => {
    const defs = [defStub({ field_type: 'multiselect' })];
    const r = validateValues(defs, { salary_band: ['a', 'x'] });
    expect(r.valid).toBe(false);
  });

  it('rejects unknown field key', () => {
    const defs = [defStub({ field_type: 'text', key: 'note', options: [] })];
    const r = validateValues(defs, { mystery: 'oops' });
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toContain('Onbekend');
  });

  it('reports required field missing', () => {
    const defs = [defStub({ field_type: 'text', key: 'note', options: [], required: true })];
    const r = validateValues(defs, {});
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toContain('verplicht');
  });

  it('accepts null as wis-actie even when required not set', () => {
    const defs = [defStub({ field_type: 'text', key: 'note', options: [] })];
    const r = validateValues(defs, { note: null });
    expect(r.valid).toBe(true);
  });

  it('rejects bad date format', () => {
    const defs = [defStub({ field_type: 'date', key: 'startdate', options: [] })];
    const r = validateValues(defs, { startdate: '01-01-2025' });
    expect(r.valid).toBe(false);
  });

  it('accepts valid ISO date', () => {
    const defs = [defStub({ field_type: 'date', key: 'startdate', options: [] })];
    const r = validateValues(defs, { startdate: '2025-01-01' });
    expect(r.valid).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CRUD
// ────────────────────────────────────────────────────────────────────────────

describe('createField', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('rejects key that is not snake_case', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      createField(TENANT_ID, USER_ID, {
        entity_type: 'candidate',
        key: 'BadKey',
        label: 'X',
        field_type: 'text',
      })
    ).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('rejects dropdown without options', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      createField(TENANT_ID, USER_ID, {
        entity_type: 'candidate',
        key: 'good_key',
        label: 'X',
        field_type: 'dropdown',
      })
    ).rejects.toMatchObject({ code: 'OPTIONS_REQUIRED' });
  });

  it('inserts and returns the new definition', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO custom_field_definitions/i.test(sql)) {
          return {
            rows: [
              {
                id: 'd1',
                tenant_id: TENANT_ID,
                entity_type: 'candidate',
                key: 'note',
                label: 'Note',
                field_type: 'text',
                options: '[]',
                required: false,
                position: 0,
                deleted_at: null,
                created_at: '2025-01-01',
                updated_at: '2025-01-01',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const def = await createField(TENANT_ID, USER_ID, {
      entity_type: 'candidate',
      key: 'note',
      label: 'Note',
      field_type: 'text',
    });
    expect(def.id).toBe('d1');
    expect(def.options).toEqual([]);
  });

  it('maps unique-violation to 409 DUPLICATE_KEY', async () => {
    client = mockClient({
      __matcher: (sql) => {
        // Allow BEGIN/COMMIT/ROLLBACK/SET through — our service throw must
        // surface to the catch block, not to withTenant's BEGIN.
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO custom_field_definitions/i.test(sql)) {
          const e = new Error('dup') as Error & { code: string };
          e.code = '23505';
          throw e;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      createField(TENANT_ID, USER_ID, {
        entity_type: 'candidate',
        key: 'good_key',
        label: 'X',
        field_type: 'text',
      })
    ).rejects.toMatchObject({ code: 'DUPLICATE_KEY' });
  });
});

describe('updateField + deleteField + getField + listFields', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('updateField throws 404 when nothing matches', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(
      updateField(TENANT_ID, USER_ID, 'missing', { label: 'New' })
    ).rejects.toMatchObject({ code: 'CUSTOM_FIELD_NOT_FOUND' });
  });

  it('deleteField soft-deletes', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/UPDATE custom_field_definitions/i.test(sql)) {
          return {
            rows: [{ id: 'd1', key: 'k', entity_type: 'candidate' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(deleteField(TENANT_ID, USER_ID, 'd1')).resolves.toBeUndefined();
  });

  it('listFields parses options JSON string', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM custom_field_definitions/i.test(sql)) {
          return {
            rows: [
              {
                id: 'd1',
                tenant_id: TENANT_ID,
                entity_type: 'candidate',
                key: 'note',
                label: 'Note',
                field_type: 'text',
                options: '[]',
                required: false,
                position: 0,
                deleted_at: null,
                created_at: 'a',
                updated_at: 'a',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const list = await listFields(TENANT_ID, 'candidate');
    expect(list).toHaveLength(1);
    expect(Array.isArray(list[0].options)).toBe(true);
  });

  it('getField throws 404 when not found', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(getField(TENANT_ID, 'missing')).rejects.toMatchObject({
      code: 'CUSTOM_FIELD_NOT_FOUND',
    });
  });
});

describe('setValuesForEntity + getValuesForEntity', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('rejects unknown key with VALIDATION_FAILED', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM custom_field_definitions/i.test(sql)) {
          return { rows: [], rowCount: 0 }; // no defs → all keys unknown
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      setValuesForEntity(TENANT_ID, USER_ID, 'candidate', 'cand-1', { mystery: 'x' })
    ).rejects.toMatchObject({ code: 'CUSTOM_FIELDS_INVALID' });
  });

  it('upserts a single value', async () => {
    let upserted = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM custom_field_definitions/i.test(sql)) {
          return {
            rows: [
              {
                id: 'd1',
                tenant_id: TENANT_ID,
                entity_type: 'candidate',
                key: 'note',
                label: 'Note',
                field_type: 'text',
                options: '[]',
                required: false,
                position: 0,
                deleted_at: null,
                created_at: 'a',
                updated_at: 'a',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO custom_field_values/i.test(sql)) {
          upserted = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await setValuesForEntity(TENANT_ID, USER_ID, 'candidate', 'cand-1', { note: 'hi' });
    expect(upserted).toBe(true);
  });

  it('getValuesForEntity returns key→value map', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM custom_field_values/i.test(sql)) {
          return {
            rows: [
              { key: 'note', value: 'hi' },
              { key: 'score', value: 7 },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const vals = await getValuesForEntity(TENANT_ID, 'candidate', 'cand-1');
    expect(vals).toEqual({ note: 'hi', score: 7 });
  });
});

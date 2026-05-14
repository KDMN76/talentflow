/**
 * whatsapp templates service tests — Sprint Q4.6 (Agent ZZZ).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  submitTemplate,
  syncTemplateStatus,
  listTemplates,
} from '../../src/modules/whatsapp/templates.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TEMPLATE_ID = '33333333-3333-3333-3333-333333333333';
const INTEGRATION_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => vi.clearAllMocks());

describe('createTemplate', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('inserts as draft with lowercased name', async () => {
    let capturedName: string | null = null;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/INSERT\s+INTO\s+whatsapp_templates/i.test(sql)) {
          capturedName = params[2] as string;
          return {
            rows: [
              {
                id: TEMPLATE_ID,
                tenant_id: TENANT_ID,
                integration_id: INTEGRATION_ID,
                name: capturedName,
                external_id: null,
                language: 'nl',
                category: 'utility',
                status: 'draft',
                header: null,
                body: 'Hi {{1}}',
                footer: null,
                buttons: [],
                example_variables: [],
                rejection_reason: null,
                submitted_at: null,
                approved_at: null,
                created_by: USER_ID,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return { rows: [{ id: INTEGRATION_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const row = await createTemplate(
      TENANT_ID,
      {
        name: 'Welcome_Message',
        language: 'nl',
        category: 'utility',
        body: 'Hi {{1}}',
      },
      { userId: USER_ID }
    );
    expect(row.status).toBe('draft');
    expect(capturedName).toBe('welcome_message');
  });
});

describe('updateTemplate', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('rejects update on approved template', async () => {
    const existing = {
      id: TEMPLATE_ID,
      tenant_id: TENANT_ID,
      status: 'approved',
      name: 'x',
      language: 'nl',
      body: 'b',
    };
    const client = mockClient({
      __matcher: async () => ({ rows: [existing], rowCount: 1 }),
    });
    teardown = installPoolMock(client);
    await expect(
      updateTemplate(TENANT_ID, TEMPLATE_ID, { body: 'new' }, { userId: USER_ID })
    ).rejects.toMatchObject({ code: 'TEMPLATE_LOCKED' });
  });

  it('allows update on draft template', async () => {
    const draft = {
      id: TEMPLATE_ID,
      tenant_id: TENANT_ID,
      status: 'draft',
      name: 'x',
      language: 'nl',
      body: 'old',
    };
    let updateCalled = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+whatsapp_templates/i.test(sql)) {
          return { rows: [draft], rowCount: 1 };
        }
        if (/UPDATE\s+whatsapp_templates/i.test(sql)) {
          updateCalled = true;
          return { rows: [{ ...draft, body: 'new' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const row = await updateTemplate(TENANT_ID, TEMPLATE_ID, { body: 'new' }, { userId: USER_ID });
    expect(updateCalled).toBe(true);
    expect(row.body).toBe('new');
  });
});

describe('deleteTemplate', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('blocks delete on approved template', async () => {
    const approved = { id: TEMPLATE_ID, tenant_id: TENANT_ID, status: 'approved', name: 'x', language: 'nl', body: 'b' };
    const client = mockClient({
      __matcher: async () => ({ rows: [approved], rowCount: 1 }),
    });
    teardown = installPoolMock(client);
    await expect(
      deleteTemplate(TENANT_ID, TEMPLATE_ID, { userId: USER_ID })
    ).rejects.toMatchObject({ code: 'TEMPLATE_LOCKED' });
  });
});

describe('submitTemplate', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  beforeEach(() => {
    delete process.env.WHATSAPP_360DIALOG_LIVE;
  });

  it('flips status to submitted and stores external_id', async () => {
    const draft = {
      id: TEMPLATE_ID,
      tenant_id: TENANT_ID,
      status: 'draft',
      name: 'welcome',
      language: 'nl',
      category: 'utility',
      header: null,
      body: 'Hi {{1}}',
      footer: null,
      buttons: [],
      example_variables: [],
    };
    const integration = (await import('../../src/lib/encryption')).encrypt('key1');
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+whatsapp_templates/i.test(sql)) {
          return { rows: [draft], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return {
            rows: [
              {
                id: INTEGRATION_ID,
                tenant_id: TENANT_ID,
                api_key_encrypted: integration,
                phone_number: '+31612345678',
                waba_id: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+whatsapp_templates/i.test(sql)) {
          return {
            rows: [
              {
                ...draft,
                status: 'submitted',
                external_id: 'wa-tpl-mock-x',
                submitted_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const row = await submitTemplate(TENANT_ID, TEMPLATE_ID, { userId: USER_ID });
    expect(row.status).toBe('submitted');
    expect(row.external_id).toMatch(/^wa-tpl-mock-/);
  });

  it('rejects when template is not in draft/rejected state', async () => {
    const submitted = {
      id: TEMPLATE_ID,
      tenant_id: TENANT_ID,
      status: 'submitted',
      name: 'x',
      language: 'nl',
      body: 'b',
    };
    const client = mockClient({
      __matcher: async () => ({ rows: [submitted], rowCount: 1 }),
    });
    teardown = installPoolMock(client);
    await expect(
      submitTemplate(TENANT_ID, TEMPLATE_ID, { userId: USER_ID })
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });
});

describe('syncTemplateStatus (mock)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('updates row status from submitted to approved when mock connector says approved', async () => {
    const submitted = {
      id: TEMPLATE_ID,
      tenant_id: TENANT_ID,
      status: 'submitted',
      external_id: 'wa-tpl-mock-x',
      name: 'x',
      language: 'nl',
      body: 'b',
    };
    const integration = (await import('../../src/lib/encryption')).encrypt('key1');
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+whatsapp_templates/i.test(sql)) {
          return { rows: [submitted], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return {
            rows: [{
              id: INTEGRATION_ID,
              tenant_id: TENANT_ID,
              api_key_encrypted: integration,
              phone_number: '+31612345678',
              waba_id: null,
            }],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+whatsapp_templates/i.test(sql)) {
          return { rows: [{ ...submitted, status: 'approved', approved_at: new Date().toISOString() }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const row = await syncTemplateStatus(TENANT_ID, TEMPLATE_ID, { userId: USER_ID });
    expect(row.status).toBe('approved');
  });
});

describe('listTemplates', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('paginates with cursor', async () => {
    const rows = [
      {
        id: 't-1',
        tenant_id: TENANT_ID,
        status: 'draft',
        name: 'x',
        language: 'nl',
        body: 'b',
        created_at: '2025-01-01T00:00:00Z',
        buttons: [],
        example_variables: [],
      },
    ];
    const client = mockClient({ whatsapp_templates: rows });
    teardown = installPoolMock(client);
    const result = await listTemplates(TENANT_ID, { limit: 50 });
    expect(result.data.length).toBe(1);
    expect(result.next_cursor).toBeNull();
  });
});

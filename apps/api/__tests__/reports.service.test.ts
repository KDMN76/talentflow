import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listReports,
  getReport,
  createReport,
  updateReport,
  deleteReport,
  duplicateReport,
  generateEmbedToken,
  revokeEmbedToken,
  getReportFromEmbedToken,
  listSystemTemplates,
  getSystemTemplate,
} from '../src/modules/reports/reports.service';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const REPORT = '33333333-3333-3333-3333-333333333333';

const validConfig = {
  date_range: { type: 'last_n_days' as const, days: 30 },
  blocks: [
    {
      id: 'k1',
      size: 'sm' as const,
      block: {
        type: 'kpi' as const,
        metric: { key: 'count', entity: 'candidates' as const, label: 'Aantal' },
      },
    },
  ],
};

const baseRow = {
  id: REPORT,
  tenant_id: TENANT,
  user_id: USER,
  name: 'Test',
  description: null,
  config: validConfig,
  template_key: 'custom',
  is_template: false,
  is_shared: false,
  embed_token: null,
  embed_enabled: false,
  schedule: null,
  last_run_at: null,
  deleted_at: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

describe('reports.service CRUD', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('listReports returns rows', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [baseRow], rowCount: 1 };
      },
    });
    teardown = installPoolMock(client);
    const r = await listReports(TENANT);
    expect(r.length).toBe(1);
    expect(r[0].id).toBe(REPORT);
  });

  it('getReport throws 404 when missing', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(getReport(TENANT, REPORT)).rejects.toMatchObject({
      code: 'REPORT_NOT_FOUND',
    });
  });

  it('createReport rejects invalid config', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      createReport(TENANT, USER, {
        name: 'Bad',
        config: { date_range: 'wrong' as never, blocks: [] } as never,
      })
    ).rejects.toMatchObject({ code: 'INVALID_REPORT_CONFIG' });
  });

  it('createReport rejects empty name', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      createReport(TENANT, USER, { name: '', config: validConfig })
    ).rejects.toMatchObject({ code: 'REPORT_NAME_REQUIRED' });
  });

  it('createReport returns row on success', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO reports/i.test(sql)) {
          return { rows: [baseRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await createReport(TENANT, USER, {
      name: 'Test',
      config: validConfig,
    });
    expect(r.id).toBe(REPORT);
    expect(r.name).toBe('Test');
  });

  it('updateReport rejects invalid config', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      updateReport(TENANT, REPORT, USER, {
        config: { date_range: 'wrong' as never, blocks: [] } as never,
      })
    ).rejects.toMatchObject({ code: 'INVALID_REPORT_CONFIG' });
  });

  it('updateReport returns updated row', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT \* FROM reports/i.test(sql)) {
          return { rows: [baseRow], rowCount: 1 };
        }
        if (/UPDATE reports/i.test(sql)) {
          return { rows: [{ ...baseRow, name: 'Renamed' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await updateReport(TENANT, REPORT, USER, { name: 'Renamed' });
    expect(r.name).toBe('Renamed');
  });

  it('deleteReport soft-deletes', async () => {
    let updateCount = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT \* FROM reports/i.test(sql)) {
          return { rows: [baseRow], rowCount: 1 };
        }
        if (/UPDATE reports SET deleted_at/i.test(sql)) {
          updateCount++;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await deleteReport(TENANT, REPORT, USER);
    expect(updateCount).toBe(1);
  });

  it('duplicateReport rejects empty name', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      duplicateReport(TENANT, REPORT, USER, '')
    ).rejects.toMatchObject({ code: 'REPORT_NAME_REQUIRED' });
  });

  it('duplicateReport copies row + assigns new name', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT \* FROM reports/i.test(sql)) {
          return { rows: [baseRow], rowCount: 1 };
        }
        if (/INSERT INTO reports/i.test(sql)) {
          return {
            rows: [{ ...baseRow, id: 'new-id', name: 'Copy of Test' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await duplicateReport(TENANT, REPORT, USER, 'Copy of Test');
    expect(r.name).toBe('Copy of Test');
  });
});

describe('reports.service embed-tokens', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('generateEmbedToken returns token + URL', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT \* FROM reports/i.test(sql)) {
          return { rows: [baseRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await generateEmbedToken(
      TENANT,
      REPORT,
      USER,
      'http://localhost:4000'
    );
    expect(r.token).toMatch(/^[a-f0-9]{64}$/);
    expect(r.url).toContain(r.token);
  });

  it('revokeEmbedToken updates row', async () => {
    let revokeCount = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT \* FROM reports/i.test(sql)) {
          return { rows: [baseRow], rowCount: 1 };
        }
        if (/UPDATE reports[\s\S]*embed_token = NULL/i.test(sql)) {
          revokeCount++;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await revokeEmbedToken(TENANT, REPORT, USER);
    expect(revokeCount).toBe(1);
  });

  it('getReportFromEmbedToken rejects malformed tokens', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(getReportFromEmbedToken('short')).rejects.toMatchObject({
      code: 'EMBED_TOKEN_INVALID',
    });
  });

  it('getReportFromEmbedToken returns report on valid hex', async () => {
    const validToken = 'a'.repeat(64);
    client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [{ ...baseRow, embed_token: validToken, embed_enabled: true }],
          rowCount: 1,
        };
      },
    });
    teardown = installPoolMock(client);
    const r = await getReportFromEmbedToken(validToken);
    expect(r.report.id).toBe(REPORT);
    expect(r.tenant_id).toBe(TENANT);
  });

  it('getReportFromEmbedToken throws when token not found', async () => {
    const validToken = 'b'.repeat(64);
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(getReportFromEmbedToken(validToken)).rejects.toMatchObject({
      code: 'EMBED_TOKEN_INVALID',
    });
  });
});

describe('reports.service templates', () => {
  it('listSystemTemplates returns 5 entries', () => {
    const ts = listSystemTemplates();
    expect(ts.length).toBe(5);
    const keys = ts.map((t) => t.key).sort();
    expect(keys).toEqual([
      'chro',
      'dei_funnel',
      'manager',
      'recruiter',
      'source_of_hire',
    ]);
  });

  it('getSystemTemplate finds known key', () => {
    const t = getSystemTemplate('recruiter');
    expect(t).not.toBeNull();
    expect(t?.name).toMatch(/Recruiter/);
  });

  it('getSystemTemplate returns null for unknown', () => {
    expect(getSystemTemplate('nonsense')).toBeNull();
  });
});

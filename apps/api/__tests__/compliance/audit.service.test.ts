/**
 * Audit-service tests — Sprint Q4.2.
 *
 * Tests:
 *   - buildDiffSummary: create / delete / update / no-change
 *   - listAuditEvents: filtering wired naar SQL met juiste parameters
 *   - listAuditEvents: cursor-pagination — has_more=true wanneer +1 row
 *   - getEntityAuditHistory: ASC sort + diff_summary populated
 *   - exportAuditTrail: csv-format header + rows
 *   - exportAuditTrail: schrijft audit.exported event
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mockClient,
  installPoolMock,
} from '../helpers/dbMock';
import {
  listAuditEvents,
  getEntityAuditHistory,
  exportAuditTrail,
  buildDiffSummary,
} from '../../src/modules/compliance/audit.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('buildDiffSummary', () => {
  it('beschrijft create-action met name', () => {
    const s = buildDiffSummary('candidate.created', null, {
      id: 'a',
      name: 'Jane Doe',
    });
    expect(s).toContain('Aangemaakt');
    expect(s).toContain('Jane Doe');
  });

  it('beschrijft delete-action', () => {
    const s = buildDiffSummary('candidate.deleted', { id: 'a', name: 'X' }, null);
    expect(s).toContain('Verwijderd');
  });

  it('vergelijkt update field-by-field', () => {
    const s = buildDiffSummary(
      'job.updated',
      { status: 'open', title: 'A' },
      { status: 'closed', title: 'A' }
    );
    expect(s).toContain('status');
    expect(s).toContain('open');
    expect(s).toContain('closed');
  });

  it('negeert id/created_at/tenant_id ruis', () => {
    const s = buildDiffSummary(
      'job.updated',
      { id: 'x', tenant_id: 't', created_at: '2024-01-01', status: 'open' },
      { id: 'x', tenant_id: 't', created_at: '2024-01-01', status: 'closed' }
    );
    expect(s).toContain('status');
    expect(s).not.toContain('tenant_id');
  });

  it('returnt action wanneer geen diff', () => {
    const s = buildDiffSummary('x.y', { a: 1 }, { a: 1 });
    expect(s).toBe('x.y');
  });

  it('truncate bij >3 verschillen', () => {
    const before = { a: 1, b: 1, c: 1, d: 1, e: 1 };
    const after = { a: 2, b: 2, c: 2, d: 2, e: 2 };
    const s = buildDiffSummary('x.y', before, after);
    expect(s).toContain('+2 meer');
  });
});

describe('listAuditEvents', () => {
  let teardown: () => void;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('returnt empty bij geen rij-en', async () => {
    const client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    const result = await listAuditEvents(TENANT_ID, { limit: 10 });
    expect(result.data).toEqual([]);
    expect(result.has_more).toBe(false);
    expect(result.next_cursor).toBeNull();
  });

  it('past entity_type filter en limit toe in SQL', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const client = mockClient({
      __matcher: (sql, params) => {
        captured.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await listAuditEvents(TENANT_ID, {
      entity_type: 'candidate',
      limit: 50,
    });

    const auditQuery = captured.find((c) => /FROM audit_events/i.test(c.sql));
    expect(auditQuery).toBeDefined();
    expect(auditQuery!.sql).toMatch(/entity_type = \$/);
    expect(auditQuery!.params).toContain('candidate');
  });

  it('has_more=true wanneer >limit rij-en zijn', async () => {
    const fakeRow = (id: string) => ({
      id,
      action: 'x.y',
      entity_type: 'candidate',
      entity_id: 'c1',
      user_id: null,
      before: null,
      after: null,
      ip_address: null,
      user_agent: null,
      request_id: null,
      created_at: '2024-01-01T00:00:00Z',
      user_name: null,
    });
    const client = mockClient({
      __matcher: () => ({
        rows: [
          fakeRow('a'),
          fakeRow('b'),
          fakeRow('c'), // limit=2 → 3 rows betekent has_more
        ],
        rowCount: 3,
      }),
    });
    teardown = installPoolMock(client);

    const result = await listAuditEvents(TENANT_ID, { limit: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.has_more).toBe(true);
    expect(result.next_cursor).not.toBeNull();
  });

  it('past cursor toe op (created_at, id)', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const client = mockClient({
      __matcher: (sql, params) => {
        captured.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await listAuditEvents(TENANT_ID, {
      cursor: { created_at: '2024-01-01T12:00:00Z', id: 'cursor-id' },
      limit: 10,
    });

    const auditQuery = captured.find((c) => /FROM audit_events/i.test(c.sql));
    expect(auditQuery!.sql).toMatch(/\(e\.created_at, e\.id\) </);
    expect(auditQuery!.params).toContain('2024-01-01T12:00:00Z');
    expect(auditQuery!.params).toContain('cursor-id');
  });

  it('bouwt diff_summary in elke rij', async () => {
    const client = mockClient({
      __matcher: () => ({
        rows: [
          {
            id: 'e1',
            action: 'candidate.created',
            entity_type: 'candidate',
            entity_id: 'c1',
            user_id: null,
            before: null,
            after: { id: 'c1', name: 'Jane' },
            ip_address: '127.0.0.1',
            user_agent: 'test',
            request_id: 'r1',
            created_at: '2024-01-01T00:00:00Z',
            user_name: 'admin',
          },
        ],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);

    const result = await listAuditEvents(TENANT_ID, { limit: 10 });
    expect(result.data[0].diff_summary).toContain('Aangemaakt');
    expect(result.data[0].diff_summary).toContain('Jane');
  });
});

describe('getEntityAuditHistory', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returnt records ASC met diff_summary', async () => {
    const client = mockClient({
      __matcher: () => ({
        rows: [
          {
            id: 'e1',
            action: 'candidate.created',
            entity_type: 'candidate',
            entity_id: 'c1',
            user_id: null,
            before: null,
            after: { id: 'c1', name: 'Jane' },
            ip_address: null,
            user_agent: null,
            request_id: null,
            created_at: '2024-01-01T00:00:00Z',
            user_name: null,
          },
          {
            id: 'e2',
            action: 'candidate.updated',
            entity_type: 'candidate',
            entity_id: 'c1',
            user_id: null,
            before: { id: 'c1', name: 'Jane' },
            after: { id: 'c1', name: 'Janet' },
            ip_address: null,
            user_agent: null,
            request_id: null,
            created_at: '2024-01-02T00:00:00Z',
            user_name: null,
          },
        ],
        rowCount: 2,
      }),
    });
    teardown = installPoolMock(client);

    const data = await getEntityAuditHistory(TENANT_ID, 'candidate', 'c1');
    expect(data).toHaveLength(2);
    expect(data[1].diff_summary).toContain('name');
  });
});

describe('exportAuditTrail', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('genereert CSV en logt audit.exported', async () => {
    let auditExportedLogged = false;
    const fakeRow = {
      id: 'e1',
      action: 'candidate.created',
      entity_type: 'candidate',
      entity_id: 'c1',
      user_id: null,
      before: null,
      after: { id: 'c1', name: 'Jane' },
      ip_address: '127.0.0.1',
      user_agent: 'test',
      request_id: 'r1',
      created_at: '2024-01-01T00:00:00Z',
      user_name: 'admin',
    };
    let listCalls = 0;
    const client = mockClient({
      __matcher: (sql, params) => {
        if (/FROM audit_events/i.test(sql)) {
          listCalls++;
          if (listCalls === 1) {
            return { rows: [fakeRow], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          if (params.includes('audit.exported')) auditExportedLogged = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await exportAuditTrail(
      TENANT_ID,
      'user-id',
      { from: '2024-01-01' },
      'csv'
    );
    expect(result.contentType).toBe('text/csv');
    expect(result.filename).toMatch(/audit_trail_/);
    const csv = result.buffer.toString();
    expect(csv).toContain('created_at,action');
    expect(csv).toContain('candidate.created');
    expect(auditExportedLogged).toBe(true);
  });

  it('genereert JSON-format', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM audit_events/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      },
    });
    teardown = installPoolMock(client);

    const result = await exportAuditTrail(TENANT_ID, 'user-id', {}, 'json');
    expect(result.contentType).toBe('application/json');
    const parsed = JSON.parse(result.buffer.toString());
    expect(parsed.tenant_id).toBe(TENANT_ID);
    expect(Array.isArray(parsed.events)).toBe(true);
  });
});

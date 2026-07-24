import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';

// Mock list-services BEFORE importing exports so the spies attach at module-load.
vi.mock('../src/modules/candidates/candidates.service', () => ({
  listCandidates: vi.fn(),
}));
vi.mock('../src/modules/jobs/jobs.service', () => ({
  listJobs: vi.fn(),
}));
vi.mock('../src/modules/pipeline/pipeline.service', () => ({
  getApplicationsForJob: vi.fn(),
}));
vi.mock('../src/modules/communications/communications.service', () => ({
  getCandidateCommunications: vi.fn(),
  getInbox: vi.fn(),
}));
vi.mock('../src/modules/workflows/workflows.service', () => ({
  listWorkflows: vi.fn(),
}));

import {
  exportData,
  buildCsv,
  escapeCsvField,
} from '../src/modules/exports/exports.service';
import * as candidatesService from '../src/modules/candidates/candidates.service';
import * as jobsService from '../src/modules/jobs/jobs.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

// ──────────────────────────────────────────────────────────────────────────────
// escapeCsvField — RFC 4180 corner cases
// ──────────────────────────────────────────────────────────────────────────────

describe('escapeCsvField', () => {
  it('returns empty string for null and undefined', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('returns plain numbers as string without quoting', () => {
    expect(escapeCsvField(42)).toBe('42');
    expect(escapeCsvField(3.14)).toBe('3.14');
    expect(escapeCsvField(0)).toBe('0');
  });

  it('serialises booleans to lowercase true/false', () => {
    expect(escapeCsvField(true)).toBe('true');
    expect(escapeCsvField(false)).toBe('false');
  });

  it('wraps strings containing commas in double quotes', () => {
    expect(escapeCsvField('Doe, Jane')).toBe('"Doe, Jane"');
  });

  it('escapes embedded double quotes by doubling them', () => {
    expect(escapeCsvField('She said "hi"')).toBe('"She said ""hi"""');
  });

  it('wraps strings with newlines in quotes', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('serialises arrays as JSON', () => {
    expect(escapeCsvField(['a', 'b'])).toBe('"[""a"",""b""]"');
  });

  it('serialises nested objects as JSON', () => {
    expect(escapeCsvField({ k: 'v', n: 1 })).toBe('"{""k"":""v"",""n"":1}"');
  });

  it('formats Date objects as ISO-8601', () => {
    const d = new Date('2026-05-07T12:00:00Z');
    expect(escapeCsvField(d)).toBe('2026-05-07T12:00:00.000Z');
  });

  it('returns empty string for invalid Date', () => {
    expect(escapeCsvField(new Date('not-a-date'))).toBe('');
  });

  it('does not quote plain ASCII without special chars', () => {
    expect(escapeCsvField('hello-world.test')).toBe('hello-world.test');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// buildCsv — header + body assembly + BOM
// ──────────────────────────────────────────────────────────────────────────────

describe('buildCsv', () => {
  const cols = [
    { label: 'id', get: (r: { id: string; name: string }) => r.id },
    { label: 'name', get: (r: { id: string; name: string }) => r.name },
  ];

  it('starts with a UTF-8 BOM', () => {
    const csv = buildCsv(cols, [{ id: '1', name: 'Sofia' }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('renders header line in declared column order', () => {
    const csv = buildCsv(cols, []);
    // Strip BOM to compare line content directly.
    expect(csv.replace(/^﻿/, '')).toBe('id,name\n');
  });

  it('renders an empty body as just header + newline (no trailing data newline)', () => {
    const csv = buildCsv(cols, []);
    expect(csv.replace(/^﻿/, '').split('\n')).toEqual(['id,name', '']);
  });

  it('escapes special chars in row values', () => {
    const csv = buildCsv(cols, [
      { id: '1', name: 'Doe, Jane' },
      { id: '2', name: 'Smith "Joe"' },
    ]);
    const lines = csv.replace(/^﻿/, '').split('\n');
    expect(lines[1]).toBe('1,"Doe, Jane"');
    expect(lines[2]).toBe('2,"Smith ""Joe"""');
  });

  it('handles diacritics correctly (UTF-8 + BOM)', () => {
    const csv = buildCsv(cols, [{ id: '1', name: 'Müllér' }]);
    // The string itself must contain the original characters; Excel will
    // interpret the BOM and decode UTF-8 properly.
    expect(csv).toContain('Müllér');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// exportData — happy paths + audit-log
// ──────────────────────────────────────────────────────────────────────────────

describe('exportData', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('exports candidates: filename, mime, headers, BOM, audit-log', async () => {
    (candidatesService.listCandidates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          id: 'cand-1',
          candidate_reference: 'ABC123',
          name: 'Sofia Vermeer',
          email: 'sofia@example.nl',
          source: 'linkedin',
          skills: ['react', 'typescript'],
          gdpr_consent: true,
          created_at: new Date('2026-05-01T10:00:00Z'),
        },
      ],
      meta: { total: 1, page: 1, limit: 1, pages: 1 },
    });

    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    const result = await exportData(TENANT_ID, {
      entity: 'candidates',
      filters: { search: 'Sofia' },
      userId: USER_ID,
    });

    expect(result.content_type).toBe('text/csv; charset=utf-8');
    expect(result.filename).toMatch(/^candidates-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.row_count).toBe(1);

    const csvText = result.buffer.toString('utf8');
    expect(csvText.charCodeAt(0)).toBe(0xfeff);
    expect(csvText).toContain('Sofia Vermeer');
    expect(csvText).toContain('sofia@example.nl');
    expect(csvText).toContain('ABC123');
    // Skills are serialised as semicolon-joined string for nicer Excel UX.
    expect(csvText).toContain('react;typescript');

    // Audit-log: er moet een data.exported INSERT INTO audit_events zijn.
    const auditCalls = client.query.mock.calls.filter((c) =>
      /INSERT INTO audit_events/i.test(String(c[0]))
    );
    expect(auditCalls.length).toBeGreaterThanOrEqual(1);
    const lastAudit = auditCalls[auditCalls.length - 1];
    const params = lastAudit[1] as unknown[];
    // params[2] is action.
    expect(params[2]).toBe('data.exported');
  });

  it('selects subset of columns when columns option supplied', async () => {
    (candidatesService.listCandidates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          id: 'cand-1',
          name: 'Sofia',
          email: 'sofia@example.nl',
          phone: '+31123',
          source: 'linkedin',
        },
      ],
      meta: { total: 1, page: 1, limit: 1, pages: 1 },
    });

    client = mockClient({});
    teardown = installPoolMock(client);

    const result = await exportData(TENANT_ID, {
      entity: 'candidates',
      columns: ['name', 'email'], // subset
      userId: USER_ID,
    });

    const csvText = result.buffer.toString('utf8').replace(/^﻿/, '');
    const headerLine = csvText.split('\n')[0];
    expect(headerLine).toBe('name,email');
    // Phone shouldn't be exported.
    expect(csvText).not.toContain('+31123');
  });

  it('exports xlsx as a real spreadsheet buffer', async () => {
    (candidatesService.listCandidates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ id: 'cand-1', name: 'Sofia', email: 'sofia@example.nl' }],
      meta: { total: 1, page: 1, limit: 1, pages: 1 },
    });
    client = mockClient({});
    teardown = installPoolMock(client);

    const result = await exportData(TENANT_ID, {
      entity: 'candidates',
      format: 'xlsx',
      userId: USER_ID,
    });

    expect(result.content_type).toContain('spreadsheetml');
    expect(result.filename).toMatch(/\.xlsx$/);
    expect(result.row_count).toBe(1);
    // XLSX (OOXML) is een ZIP — begint met de "PK"-magic bytes.
    expect(result.buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('exports pdf as a real PDF buffer', async () => {
    (candidatesService.listCandidates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ id: 'cand-1', name: 'Sofia', email: 'sofia@example.nl', phone: '+31123' }],
      meta: { total: 1, page: 1, limit: 1, pages: 1 },
    });
    client = mockClient({});
    teardown = installPoolMock(client);

    const result = await exportData(TENANT_ID, {
      entity: 'candidates',
      format: 'pdf',
      userId: USER_ID,
    });

    expect(result.content_type).toBe('application/pdf');
    expect(result.filename).toMatch(/\.pdf$/);
    expect(result.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('rejects an unknown format with 400', async () => {
    await expect(
      exportData(TENANT_ID, {
        entity: 'candidates',
        format: 'docx' as unknown as 'csv',
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'EXPORT_FORMAT_INVALID' });
  });

  it('exports jobs through jobsService.listJobs', async () => {
    (jobsService.listJobs as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          id: 'job-1',
          job_reference: 'JOB-AB1234',
          title: 'Senior Engineer',
          status: 'open',
          location: 'Amsterdam',
        },
      ],
      meta: { total: 1, page: 1, limit: 1, pages: 1 },
    });

    client = mockClient({});
    teardown = installPoolMock(client);

    const result = await exportData(TENANT_ID, {
      entity: 'jobs',
      filters: { status: 'open' },
    });
    const csv = result.buffer.toString('utf8');
    expect(csv).toContain('Senior Engineer');
    expect(csv).toContain('JOB-AB1234');
    expect(jobsService.listJobs).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ status: 'open' })
    );
  });

  it('handles empty result set (header only + audit-log still fires)', async () => {
    (candidatesService.listCandidates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 0, pages: 0 },
    });

    client = mockClient({});
    teardown = installPoolMock(client);

    const result = await exportData(TENANT_ID, { entity: 'candidates' });
    expect(result.row_count).toBe(0);

    const auditCalls = client.query.mock.calls.filter((c) =>
      /INSERT INTO audit_events/i.test(String(c[0]))
    );
    expect(auditCalls.length).toBeGreaterThanOrEqual(1);
  });
});

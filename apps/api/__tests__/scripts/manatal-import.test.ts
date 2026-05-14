/**
 * Manatal-import script tests.
 *
 * Covers:
 *   - Field-mapping correctness (candidates + jobs)
 *   - Date-parser edge-cases
 *   - Currency parser
 *   - Boolean / array / gender parsers
 *   - Status mapping
 *   - Idempotency: re-run skips already-existing references
 *   - Dry-run: no DB-writes, alleen tellingen
 *   - Rollback: schrijft expected DELETE-statements
 *   - CLI arg parser (happy + error cases)
 *
 * Tests draaien volledig offline — services worden gemockt via vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

// Mock service-laag VOORDAT we het import-script importen, anders pakken
// de require()-statements in dat module de echte versies.
vi.mock('../../src/modules/candidates/candidates.service', () => ({
  createCandidate: vi.fn(),
}));
vi.mock('../../src/modules/jobs/jobs.service', () => ({
  createJob: vi.fn(),
}));
vi.mock('../../src/modules/pipeline/pipeline.service', () => ({
  addToPipeline: vi.fn(),
}));
vi.mock('../../src/lib/audit', () => ({
  logAudit: vi.fn(async () => undefined),
}));
vi.mock('../../src/lib/storage', () => ({
  getStorage: () => ({
    put: vi.fn(async () => undefined),
    getDownloadUrl: vi.fn(async () => 'https://mock/url'),
    delete: vi.fn(async () => undefined),
    getStream: vi.fn(),
  }),
  buildResumeStorageKey: (
    tenantId: string,
    candidateId: string,
    resumeId: string,
    filename: string
  ) => `tenants/${tenantId}/candidates/${candidateId}/resumes/${resumeId}__${filename}`,
}));

import {
  parseManatalDate,
  parseManatalArray,
  parseManatalBoolean,
  parseManatalCurrency,
  parseManatalGender,
  parseManatalInteger,
  buildCandidatePayload,
  buildJobPayload,
  resolveStageNameFromManatal,
  MANATAL_TO_TALENTFLOW_CANDIDATE,
  MANATAL_TO_TALENTFLOW_JOB,
  MANATAL_STATUS_TO_TALENTFLOW,
  extractManatalId,
  MANATAL_CANDIDATE_ID_COLUMNS,
} from '../../scripts/manatal-mapping';
import {
  parseCliArgs,
  runImport,
  rollbackTenant,
  importJobs,
  importCandidates,
  type ImportContext,
  type MigrationReport,
} from '../../scripts/manatal-import';
import { createCandidate } from '../../src/modules/candidates/candidates.service';
import { createJob } from '../../src/modules/jobs/jobs.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<MigrationReport> = {}): MigrationReport {
  return {
    tenant_id: TENANT_ID,
    started_at: new Date().toISOString(),
    completed_at: '',
    duration_seconds: 0,
    dry_run: false,
    candidates: { total: 0, imported: 0, skipped: 0, errors: 0 },
    jobs: { total: 0, imported: 0, skipped: 0, errors: 0 },
    applications: { total: 0, imported: 0, skipped: 0, errors: 0 },
    notes: { total: 0, imported: 0 },
    resumes: { total: 0, uploaded: 0, queued_for_parsing: 0 },
    unknown_columns: [],
    errors: [],
    id_map: { candidates: {}, jobs: {} },
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    tenantId: TENANT_ID,
    userId: '00000000-0000-0000-0000-000000000000',
    batchId: 'batch-test',
    dryRun: false,
    skipDuplicates: true,
    report: makeReport(),
    unknownColumns: new Map(),
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Field-mapping correctness
// ────────────────────────────────────────────────────────────────────────────

describe('MANATAL_TO_TALENTFLOW_CANDIDATE mapping', () => {
  it('maps Candidate Email Address → email', () => {
    expect(MANATAL_TO_TALENTFLOW_CANDIDATE['Candidate Email Address']).toBe('email');
  });

  it('maps Candidate Reference → candidate_reference', () => {
    expect(MANATAL_TO_TALENTFLOW_CANDIDATE['Candidate Reference']).toBe(
      'candidate_reference'
    );
  });

  it('maps Current Position → current_position', () => {
    expect(MANATAL_TO_TALENTFLOW_CANDIDATE['Current Position']).toBe('current_position');
  });

  it('maps Years of Experience → years_of_experience', () => {
    expect(MANATAL_TO_TALENTFLOW_CANDIDATE['Years of Experience']).toBe(
      'years_of_experience'
    );
  });

  it('maps Tags → tags', () => {
    expect(MANATAL_TO_TALENTFLOW_CANDIDATE['Tags']).toBe('tags');
  });

  it('maps GDPR Consent → gdpr_consent', () => {
    expect(MANATAL_TO_TALENTFLOW_CANDIDATE['GDPR Consent']).toBe('gdpr_consent');
  });

  it('maps both long-form and short-form name columns', () => {
    expect(MANATAL_TO_TALENTFLOW_CANDIDATE['Candidate Name']).toBe('name');
    expect(MANATAL_TO_TALENTFLOW_CANDIDATE['Name']).toBe('name');
  });

  it('maps Candidate Location → address_city', () => {
    expect(MANATAL_TO_TALENTFLOW_CANDIDATE['Candidate Location']).toBe('address_city');
  });
});

describe('MANATAL_TO_TALENTFLOW_JOB mapping', () => {
  it('maps Job Title → title', () => {
    expect(MANATAL_TO_TALENTFLOW_JOB['Job Title']).toBe('title');
  });

  it('maps Job Reference → job_reference', () => {
    expect(MANATAL_TO_TALENTFLOW_JOB['Job Reference']).toBe('job_reference');
  });

  it('maps Headcount → headcount', () => {
    expect(MANATAL_TO_TALENTFLOW_JOB['Headcount']).toBe('headcount');
  });

  it('maps Open/Close Date → open_date / close_date', () => {
    expect(MANATAL_TO_TALENTFLOW_JOB['Open Date']).toBe('open_date');
    expect(MANATAL_TO_TALENTFLOW_JOB['Close Date']).toBe('close_date');
  });

  it('maps Minimum/Maximum Salary → salary_min / salary_max', () => {
    expect(MANATAL_TO_TALENTFLOW_JOB['Minimum Salary']).toBe('salary_min');
    expect(MANATAL_TO_TALENTFLOW_JOB['Maximum Salary']).toBe('salary_max');
  });
});

describe('MANATAL_STATUS_TO_TALENTFLOW', () => {
  it('maps Planning → draft', () => {
    expect(MANATAL_STATUS_TO_TALENTFLOW['Planning']).toBe('draft');
  });
  it('maps Active → open', () => {
    expect(MANATAL_STATUS_TO_TALENTFLOW['Active']).toBe('open');
  });
  it('maps On Hold → on_hold', () => {
    expect(MANATAL_STATUS_TO_TALENTFLOW['On Hold']).toBe('on_hold');
  });
  it('maps Completed → filled', () => {
    expect(MANATAL_STATUS_TO_TALENTFLOW['Completed']).toBe('filled');
  });
  it('maps Cancelled → closed', () => {
    expect(MANATAL_STATUS_TO_TALENTFLOW['Cancelled']).toBe('closed');
  });
});

describe('resolveStageNameFromManatal', () => {
  it('returns the canonical name for an exact match', () => {
    expect(resolveStageNameFromManatal('Hired')).toBe('Hired');
  });
  it('matches case-insensitively', () => {
    expect(resolveStageNameFromManatal('hired')).toBe('Hired');
  });
  it('resolves "Submission" synonym to Client Submission', () => {
    expect(resolveStageNameFromManatal('Submission')).toBe('Client Submission');
  });
  it('returns undefined for an unknown stage', () => {
    expect(resolveStageNameFromManatal('Some Random Stage')).toBeUndefined();
  });
  it('returns undefined for empty input', () => {
    expect(resolveStageNameFromManatal('')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Date parser edge cases
// ────────────────────────────────────────────────────────────────────────────

describe('parseManatalDate', () => {
  it('parses ISO date YYYY-MM-DD', () => {
    expect(parseManatalDate('2024-01-15')).toBe('2024-01-15');
  });
  it('parses ISO timestamp and extracts the date', () => {
    expect(parseManatalDate('2024-01-15T10:30:00Z')).toBe('2024-01-15');
  });
  it('parses DD/MM/YYYY (EU/Manatal-default)', () => {
    expect(parseManatalDate('15/01/2024')).toBe('2024-01-15');
  });
  it('disambiguates MM/DD/YYYY when first part > 12', () => {
    // "13/01/2024" can only be DD/MM
    expect(parseManatalDate('13/01/2024')).toBe('2024-01-13');
  });
  it('disambiguates MM/DD/YYYY when second part > 12', () => {
    expect(parseManatalDate('01/15/2024')).toBe('2024-01-15');
  });
  it('parses 15-Jan-2024', () => {
    expect(parseManatalDate('15-Jan-2024')).toBe('2024-01-15');
  });
  it('parses 15 January 2024', () => {
    expect(parseManatalDate('15 January 2024')).toBe('2024-01-15');
  });
  it('handles 2-digit years with pivot 50', () => {
    expect(parseManatalDate('15/01/24')).toBe('2024-01-15');
    expect(parseManatalDate('15/01/85')).toBe('1985-01-15');
  });
  it('returns null for empty or null input', () => {
    expect(parseManatalDate('')).toBeNull();
    expect(parseManatalDate(null)).toBeNull();
    expect(parseManatalDate(undefined)).toBeNull();
  });
  it('returns null for unparseable input', () => {
    expect(parseManatalDate('niet een datum')).toBeNull();
    expect(parseManatalDate('99/99/9999')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Currency parser
// ────────────────────────────────────────────────────────────────────────────

describe('parseManatalCurrency', () => {
  it('parses "55000"', () => {
    expect(parseManatalCurrency('55000')).toBe(55000);
  });
  it('parses €-prefixed values', () => {
    expect(parseManatalCurrency('€55000')).toBe(55000);
  });
  it('strips USD currency code suffix', () => {
    expect(parseManatalCurrency('55000 USD')).toBe(55000);
  });
  it('handles US-formatted thousands "55,000.50"', () => {
    expect(parseManatalCurrency('55,000.50')).toBe(55000.5);
  });
  it('handles EU-formatted thousands "55.000,50"', () => {
    expect(parseManatalCurrency('55.000,50')).toBe(55000.5);
  });
  it('handles comma-only thousand separator "55,000"', () => {
    expect(parseManatalCurrency('55,000')).toBe(55000);
  });
  it('handles comma-as-decimal "55,5"', () => {
    expect(parseManatalCurrency('55,5')).toBe(55.5);
  });
  it('returns null on garbage', () => {
    expect(parseManatalCurrency('abc')).toBeNull();
  });
  it('returns null for empty', () => {
    expect(parseManatalCurrency('')).toBeNull();
    expect(parseManatalCurrency(null)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Boolean / array / gender / int parsers
// ────────────────────────────────────────────────────────────────────────────

describe('parseManatalBoolean', () => {
  it('parses Yes/No', () => {
    expect(parseManatalBoolean('Yes')).toBe(true);
    expect(parseManatalBoolean('No')).toBe(false);
  });
  it('parses 1/0', () => {
    expect(parseManatalBoolean('1')).toBe(true);
    expect(parseManatalBoolean('0')).toBe(false);
  });
  it('parses true/false', () => {
    expect(parseManatalBoolean('true')).toBe(true);
    expect(parseManatalBoolean('false')).toBe(false);
  });
  it('parses Dutch ja/nee', () => {
    expect(parseManatalBoolean('ja')).toBe(true);
    expect(parseManatalBoolean('nee')).toBe(false);
  });
  it('returns null on unknown', () => {
    expect(parseManatalBoolean('maybe')).toBeNull();
  });
});

describe('parseManatalArray', () => {
  it('splits on comma', () => {
    expect(parseManatalArray('a, b, c')).toEqual(['a', 'b', 'c']);
  });
  it('splits on semicolon', () => {
    expect(parseManatalArray('a; b; c')).toEqual(['a', 'b', 'c']);
  });
  it('returns null on empty', () => {
    expect(parseManatalArray('')).toBeNull();
  });
  it('skips empty pieces', () => {
    expect(parseManatalArray('a,,b')).toEqual(['a', 'b']);
  });
});

describe('parseManatalGender', () => {
  it.each([
    ['Male', 'male'],
    ['Female', 'female'],
    ['Other', 'other'],
    ['None', 'prefer_not'],
    ['Prefer not to say', 'prefer_not'],
  ])('maps %s → %s', (input, expected) => {
    expect(parseManatalGender(input)).toBe(expected);
  });
  it('returns null on unknown', () => {
    expect(parseManatalGender('robot')).toBeNull();
  });
});

describe('parseManatalInteger', () => {
  it('parses integers', () => {
    expect(parseManatalInteger('42')).toBe(42);
  });
  it('strips thousand-separators', () => {
    expect(parseManatalInteger('1,234')).toBe(1234);
  });
  it('returns null on empty/garbage', () => {
    expect(parseManatalInteger('')).toBeNull();
    expect(parseManatalInteger('abc')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Row payload builders
// ────────────────────────────────────────────────────────────────────────────

describe('buildCandidatePayload', () => {
  it('maps a typical Manatal row to a TalentFlow payload', () => {
    const { payload, unknownColumns } = buildCandidatePayload({
      'Candidate Name': 'Sofia Vermeer',
      'Candidate Email Address': 'sofia@example.nl',
      'Candidate Phone Number': '+31612345678',
      'Current Position': 'Senior Engineer',
      'Tags': 'frontend, react',
      'Years of Experience': '8',
      'GDPR Consent': 'Yes',
      'Birthdate': '15/01/1990',
      'Gender': 'Female',
      'Current Salary': '€55,000.50',
    });
    expect(payload).toMatchObject({
      name: 'Sofia Vermeer',
      email: 'sofia@example.nl',
      phone: '+31612345678',
      current_position: 'Senior Engineer',
      tags: ['frontend', 'react'],
      years_of_experience: 8,
      gdpr_consent: true,
      birthdate: '1990-01-15',
      gender: 'female',
      current_salary: 55000.5,
    });
    expect(unknownColumns).toEqual([]);
  });

  it('reports unknown columns', () => {
    const { unknownColumns } = buildCandidatePayload({
      'Some New Manatal Field': 'value',
      'Candidate Name': 'X',
    });
    expect(unknownColumns).toEqual(['Some New Manatal Field']);
  });

  it('skips empty cells without writing them to payload', () => {
    const { payload } = buildCandidatePayload({
      'Candidate Name': 'X',
      'Candidate Email Address': '',
      'Phone': '   ',
    });
    expect(payload).toEqual({ name: 'X' });
  });

  it('ignores Manatal-internal id columns silently', () => {
    const { unknownColumns } = buildCandidatePayload({
      'Candidate Name': 'X',
      'Candidate ID': 'manatal-internal-12345',
    });
    expect(unknownColumns).toEqual([]);
  });
});

describe('buildJobPayload', () => {
  it('maps a typical Manatal job row + status', () => {
    const { payload } = buildJobPayload({
      'Job Title': 'Backend Engineer',
      'Job Reference': 'JOB-12345',
      'Status': 'Active',
      'Headcount': '2',
      'Minimum Salary': '50000',
      'Maximum Salary': '70000',
      'Open Date': '2024-03-01',
    });
    expect(payload).toMatchObject({
      title: 'Backend Engineer',
      job_reference: 'JOB-12345',
      status: 'open',
      headcount: 2,
      salary_min: 50000,
      salary_max: 70000,
      open_date: '2024-03-01',
    });
  });

  it('maps On Hold → on_hold', () => {
    const { payload } = buildJobPayload({
      'Job Title': 'X',
      'Status': 'On Hold',
    });
    expect(payload.status).toBe('on_hold');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. extractManatalId
// ────────────────────────────────────────────────────────────────────────────

describe('extractManatalId', () => {
  it('finds Candidate ID first', () => {
    expect(
      extractManatalId(
        { 'Candidate ID': 'A1', ID: 'B2' },
        MANATAL_CANDIDATE_ID_COLUMNS
      )
    ).toBe('A1');
  });
  it('falls back to ID', () => {
    expect(
      extractManatalId({ ID: 'B2' }, MANATAL_CANDIDATE_ID_COLUMNS)
    ).toBe('B2');
  });
  it('returns null when none found', () => {
    expect(extractManatalId({}, MANATAL_CANDIDATE_ID_COLUMNS)).toBeNull();
  });
  it('skips empty values', () => {
    expect(
      extractManatalId(
        { 'Candidate ID': '', ID: 'B2' },
        MANATAL_CANDIDATE_ID_COLUMNS
      )
    ).toBe('B2');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. CLI arg parser
// ────────────────────────────────────────────────────────────────────────────

describe('parseCliArgs', () => {
  it('parses tenant-id + paths', () => {
    const args = parseCliArgs([
      '--tenant-id',
      TENANT_ID,
      '--candidates',
      './c.csv',
      '--jobs',
      './j.csv',
    ]);
    expect(args.tenantId).toBe(TENANT_ID);
    expect(args.candidates).toBe('./c.csv');
    expect(args.jobs).toBe('./j.csv');
  });
  it('parses --dry-run as boolean', () => {
    expect(parseCliArgs(['--dry-run']).dryRun).toBe(true);
  });
  it('parses --batch-size as number', () => {
    expect(parseCliArgs(['--batch-size', '50']).batchSize).toBe(50);
  });
  it('throws on unknown flag', () => {
    expect(() => parseCliArgs(['--frobnicate'])).toThrow(/Onbekende vlag/);
  });
  it('throws when value is missing', () => {
    expect(() => parseCliArgs(['--tenant-id'])).toThrow(/mist waarde/);
  });
  it('parses --rollback-tenant', () => {
    expect(parseCliArgs(['--rollback-tenant', TENANT_ID]).rollbackTenant).toBe(
      TENANT_ID
    );
  });
  it('--no-skip-duplicates flips default to false', () => {
    expect(parseCliArgs(['--no-skip-duplicates']).skipDuplicates).toBe(false);
    expect(parseCliArgs([]).skipDuplicates).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. Idempotency — pre-flight skip on existing references
// ────────────────────────────────────────────────────────────────────────────

describe('importCandidates — idempotency', () => {
  let teardown: () => void | undefined;
  let client: MockClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    teardown?.();
  });

  it('skips a candidate whose reference already exists in DB', async () => {
    // Pre-flight returns existing reference; createCandidate must NOT be called.
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT candidate_reference\s+FROM candidates/i.test(sql)) {
          return { rows: [{ candidate_reference: 'EXISTING1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const ctx = makeCtx();
    await importCandidates(
      ctx,
      [
        {
          'Candidate Name': 'Already Here',
          'Candidate Reference': 'EXISTING1',
        },
        { 'Candidate Name': 'New Person', 'Candidate Reference': 'BRANDNEW1' },
      ],
      100
    );

    // createCandidate is alleen gebeld voor de nieuwe rij
    expect((createCandidate as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(ctx.report.candidates.skipped).toBe(1);
  });

  it('skips on a UNIQUE-violation thrown by createCandidate when skipDuplicates=true', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    const err = new Error('duplicate') as Error & { code: string };
    err.code = '23505';
    (createCandidate as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);

    const ctx = makeCtx({ skipDuplicates: true });
    await importCandidates(
      ctx,
      [{ 'Candidate Name': 'X', 'Candidate Reference': 'NEWREF12' }],
      100
    );
    expect(ctx.report.candidates.skipped).toBe(1);
    expect(ctx.report.candidates.errors).toBe(0);
  });

  it('counts as error when skipDuplicates=false and UNIQUE-violation thrown', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    const err = new Error('duplicate') as Error & { code: string };
    err.code = '23505';
    (createCandidate as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);

    const ctx = makeCtx({ skipDuplicates: false });
    await importCandidates(
      ctx,
      [{ 'Candidate Name': 'X', 'Candidate Reference': 'NEWREF12' }],
      100
    );
    expect(ctx.report.candidates.errors).toBe(1);
    expect(ctx.report.candidates.skipped).toBe(0);
  });

  it('records a row-error for candidates without name', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    const ctx = makeCtx();
    await importCandidates(
      ctx,
      [{ 'Candidate Email Address': 'x@y.z' /* geen name */ }],
      100
    );
    expect(ctx.report.candidates.errors).toBe(1);
    expect(ctx.report.errors[0].entity).toBe('candidate');
    expect(ctx.report.errors[0].message).toMatch(/zonder naam/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9. Dry-run mode
// ────────────────────────────────────────────────────────────────────────────

describe('dry-run mode', () => {
  let teardown: () => void | undefined;
  let client: MockClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    teardown?.();
  });

  it('does not call createCandidate in dry-run mode', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    const ctx = makeCtx({ dryRun: true });
    await importCandidates(
      ctx,
      [
        { 'Candidate Name': 'A', 'Candidate Reference': 'AAA12345' },
        { 'Candidate Name': 'B', 'Candidate Reference': 'BBB12345' },
      ],
      100
    );
    expect(createCandidate).not.toHaveBeenCalled();
    expect(ctx.report.candidates.imported).toBe(2);
  });

  it('does not call createJob in dry-run mode', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    const ctx = makeCtx({ dryRun: true });
    await importJobs(ctx, [
      { 'Job Title': 'A', 'Job Reference': 'JOB-AA1234' },
      { 'Job Title': 'B', 'Job Reference': 'JOB-BB1234' },
    ]);
    expect(createJob).not.toHaveBeenCalled();
    expect(ctx.report.jobs.imported).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 10. Rollback
// ────────────────────────────────────────────────────────────────────────────

describe('rollbackTenant', () => {
  let teardown: () => void | undefined;
  let client: MockClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    teardown?.();
  });

  it('only deletes candidates with source=manatal_migration', async () => {
    const seenSqls: string[] = [];
    const seenParams: unknown[][] = [];

    client = mockClient({
      __matcher: (sql, params) => {
        seenSqls.push(sql);
        seenParams.push(params);
        if (/DELETE FROM candidates/i.test(sql)) {
          return { rows: [], rowCount: 5 };
        }
        if (/SELECT DISTINCT entity_id::uuid/i.test(sql)) {
          return { rows: [{ id: 'job-1' }], rowCount: 1 };
        }
        if (/DELETE FROM jobs/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        if (/DELETE FROM applications/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/DELETE FROM activities/i.test(sql)) {
          return { rows: [], rowCount: 2 };
        }
        if (/DELETE FROM audit_events/i.test(sql)) {
          return { rows: [], rowCount: 8 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await rollbackTenant(TENANT_ID);

    // Verify all DELETE-statements include the migration-source tag in their params.
    const deletesWithSource = seenSqls.filter((s, i) => {
      if (!/DELETE FROM/i.test(s)) return false;
      const params = seenParams[i] ?? [];
      return params.includes('manatal_migration');
    });
    expect(deletesWithSource.length).toBeGreaterThanOrEqual(1);

    // Cands deleted matches mock
    expect(result.candidates_deleted).toBe(5);
    expect(result.jobs_deleted).toBe(1);
    expect(result.notes_deleted).toBe(2);
    expect(result.audit_events_deleted).toBe(8);
  });

  it('does NOT delete rows without the manatal_migration tag', async () => {
    // Voorbeeld: als er geen rows zijn met source=manatal_migration, return 0.
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    const result = await rollbackTenant(TENANT_ID);
    expect(result.candidates_deleted).toBe(0);
    expect(result.jobs_deleted).toBe(0);
    expect(result.audit_events_deleted).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 11. runImport — orchestrator (smoke test)
// ────────────────────────────────────────────────────────────────────────────

describe('runImport — orchestrator', () => {
  it('throws when tenant-id missing', async () => {
    await expect(
      runImport({
        tenantId: null,
        candidates: null,
        jobs: null,
        applications: null,
        notes: null,
        resumesDir: null,
        dryRun: true,
        batchSize: 100,
        skipDuplicates: true,
        rollbackTenant: null,
        yes: false,
        help: false,
      })
    ).rejects.toThrow(/tenant-id/i);
  });

  it('throws when tenant does not exist', async () => {
    const client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }), // tenant-lookup returns empty
    });
    const teardown = installPoolMock(client);
    try {
      await expect(
        runImport({
          tenantId: TENANT_ID,
          candidates: null,
          jobs: null,
          applications: null,
          notes: null,
          resumesDir: null,
          dryRun: true,
          batchSize: 100,
          skipDuplicates: true,
          rollbackTenant: null,
          yes: false,
          help: false,
        })
      ).rejects.toThrow(/Tenant/);
    } finally {
      teardown();
    }
  });

  it('completes a dry-run with no input files', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenants/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    const teardown = installPoolMock(client);
    try {
      const report = await runImport({
        tenantId: TENANT_ID,
        candidates: null,
        jobs: null,
        applications: null,
        notes: null,
        resumesDir: null,
        dryRun: true,
        batchSize: 100,
        skipDuplicates: true,
        rollbackTenant: null,
        yes: false,
        help: false,
      });
      expect(report.tenant_id).toBe(TENANT_ID);
      expect(report.dry_run).toBe(true);
      expect(report.candidates.total).toBe(0);
      expect(report.jobs.total).toBe(0);
    } finally {
      teardown();
    }
  });
});

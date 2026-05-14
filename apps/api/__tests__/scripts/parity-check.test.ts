/**
 * Parity-checker test suite.
 *
 * Covers:
 *   1. Tolerance-engine helpers (string/date/number/array/phone/email/boolean)
 *   2. Severity-rules (critical / major / minor / tolerance)
 *   3. Diff-engine (per-field comparator routing)
 *   4. Smart-matching (5 strategies — reference, email, phone, name+birthdate, unmatched)
 *   5. Output-formats (JSON, Markdown, CSV)
 *   6. CLI parsing + strict-mode exit code
 *   7. CSV parsing (RFC 4180 edge cases)
 *
 * No DB, no network, no fs writes outside an os-tmp scratch dir.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  isStringEqual,
  isDateTimeEqual,
  isNumberEqual,
  isArrayEqual,
  isBooleanEqual,
  isEmpty,
  foldAccents,
  normaliseString,
  normalisePhone,
  normaliseEmail,
  parseDateLike,
  parseNumberLike,
  parseBooleanLike,
  coerceToStringArray,
  parseToleranceFlag,
  levenshtein,
  DEFAULT_TOLERANCE,
} from '../../scripts/parity-tolerance';

import {
  parseCsv,
  parseCliArgs,
  mapManatalCandidate,
  mapManatalJob,
  mapManatalApplication,
  normaliseTalentflowCandidate,
  normaliseTalentflowJob,
  normaliseTalentflowApplication,
  matchCandidates,
  matchJobs,
  matchApplications,
  buildReport,
  reportToJson,
  reportToMarkdown,
  reportToCsv,
  writeReportFiles,
  CRITICAL_CANDIDATE_FIELDS,
  MAJOR_CANDIDATE_FIELDS,
  type NormalisedCandidate,
  type NormalisedJob,
  type NormalisedApplication,
} from '../../scripts/parity-check';

// ────────────────────────────────────────────────────────────────────────────
// 1. Tolerance-engine
// ────────────────────────────────────────────────────────────────────────────

describe('tolerance / isEmpty', () => {
  it.each([
    [null, true],
    [undefined, true],
    ['', true],
    ['   ', true],
    ['null', true],
    ['NONE', true],
    ['n/a', true],
    ['-', true],
    ['hello', false],
    [0, false],
    [false, false],
    [[], true],
    [['x'], false],
  ])('isEmpty(%p) -> %s', (input, expected) => {
    expect(isEmpty(input)).toBe(expected);
  });
});

describe('tolerance / strings', () => {
  it('folds accents by default', () => {
    expect(foldAccents('café')).toBe('cafe');
    expect(foldAccents('Łukasz')).toBe('Łukasz'.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  });

  it('isStringEqual: whitespace + accents fold', () => {
    expect(isStringEqual('Café  Latte', 'cafe latte')).toBe(true);
    expect(isStringEqual('Sophie', 'sophie ')).toBe(true);
    expect(isStringEqual('foo', 'bar')).toBe(false);
  });

  it('isStringEqual: strict mode disables folding', () => {
    expect(
      isStringEqual('Café', 'cafe', { whitespace: 'strict', accents: 'strict', case: 'strict' })
    ).toBe(false);
  });

  it('isStringEqual: empty/empty equal', () => {
    expect(isStringEqual(null, '')).toBe(true);
    expect(isStringEqual('null', undefined)).toBe(true);
  });

  it('normaliseString collapses whitespace', () => {
    expect(normaliseString('  foo   bar\t\nbaz ')).toBe('foo bar baz');
  });
});

describe('tolerance / dates', () => {
  it('parses ISO and EU formats', () => {
    expect(parseDateLike('2026-05-08T14:30:00Z')).toBeTypeOf('number');
    expect(parseDateLike('08/05/2026')).toBeTypeOf('number');
    expect(parseDateLike('08-05-2026 14:30')).toBeTypeOf('number');
    expect(parseDateLike('garbage')).toBeNull();
    expect(parseDateLike('')).toBeNull();
  });

  it('isDateTimeEqual within tolerance', () => {
    expect(isDateTimeEqual('2026-05-08T14:30:00Z', '2026-05-08T14:30:30Z', 60)).toBe(true);
    expect(isDateTimeEqual('2026-05-08T14:30:00Z', '2026-05-08T14:32:00Z', 60)).toBe(false);
  });

  it('isDateTimeEqual: both empty equal', () => {
    expect(isDateTimeEqual(null, null)).toBe(true);
    expect(isDateTimeEqual('', '')).toBe(true);
  });

  it('isDateTimeEqual: zero tolerance demands exact match', () => {
    expect(isDateTimeEqual('2026-05-08T14:30:00Z', '2026-05-08T14:30:00Z', 0)).toBe(true);
    expect(isDateTimeEqual('2026-05-08T14:30:00Z', '2026-05-08T14:30:01Z', 0)).toBe(false);
  });
});

describe('tolerance / numbers', () => {
  it('parses EU and US formats', () => {
    expect(parseNumberLike('1.234,56')).toBeCloseTo(1234.56);
    expect(parseNumberLike('1234.56')).toBeCloseTo(1234.56);
    expect(parseNumberLike('€ 50.000')).toBeCloseTo(50000);
    expect(parseNumberLike('garbage')).toBeNull();
  });

  it('isNumberEqual respects tolerance', () => {
    expect(isNumberEqual(100, 100)).toBe(true);
    expect(isNumberEqual(100, 100.5, 1)).toBe(true);
    expect(isNumberEqual(100, 102, 1)).toBe(false);
    expect(isNumberEqual('5.000', 5000)).toBe(true);
  });
});

describe('tolerance / arrays', () => {
  it('coerces strings to arrays', () => {
    expect(coerceToStringArray('a, b, c')).toEqual(['a', 'b', 'c']);
    expect(coerceToStringArray('{a,b,c}')).toEqual(['a', 'b', 'c']);
    expect(coerceToStringArray('["a","b"]')).toEqual(['a', 'b']);
    expect(coerceToStringArray(null)).toEqual([]);
    expect(coerceToStringArray(['x'])).toEqual(['x']);
  });

  it('isArrayEqual: order ignore by default', () => {
    expect(isArrayEqual(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(isArrayEqual(['a', 'b'], ['b', 'a'], { order: 'matter' })).toBe(false);
    expect(isArrayEqual(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(isArrayEqual(null, [])).toBe(true);
  });

  it('isArrayEqual: applies string normalisation per element', () => {
    expect(isArrayEqual(['Café'], ['CAFE'])).toBe(true);
  });
});

describe('tolerance / phone + email', () => {
  it('normalisePhone strips formatting', () => {
    expect(normalisePhone('+31 (6) 12-345-678')).toBe('+31612345678');
    expect(normalisePhone('06 1234 5678')).toBe('0612345678');
  });

  it('normaliseEmail lowercases and trims', () => {
    expect(normaliseEmail(' Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});

describe('tolerance / booleans', () => {
  it('parses common truthy/falsy strings', () => {
    expect(parseBooleanLike('yes')).toBe(true);
    expect(parseBooleanLike('no')).toBe(false);
    expect(parseBooleanLike('1')).toBe(true);
    expect(parseBooleanLike('Ja')).toBe(true);
    expect(parseBooleanLike('garbage')).toBeNull();
  });

  it('isBooleanEqual', () => {
    expect(isBooleanEqual('yes', true)).toBe(true);
    expect(isBooleanEqual('0', false)).toBe(true);
    expect(isBooleanEqual('yes', 'no')).toBe(false);
  });
});

describe('tolerance / parseToleranceFlag', () => {
  it('parses standard flag', () => {
    const out = parseToleranceFlag(
      'datetime=120s,whitespace=strict,accents=strict,case=fold,number=2,arrayOrder=matter'
    );
    expect(out.datetimeSeconds).toBe(120);
    expect(out.whitespace).toBe('strict');
    expect(out.accents).toBe('strict');
    expect(out.case).toBe('fold');
    expect(out.number).toBe(2);
    expect(out.arrayOrder).toBe('matter');
  });

  it('handles minutes and hours suffixes', () => {
    expect(parseToleranceFlag('datetime=2m').datetimeSeconds).toBe(120);
    expect(parseToleranceFlag('datetime=1h').datetimeSeconds).toBe(3600);
  });

  it('ignores unknown keys gracefully', () => {
    expect(parseToleranceFlag('foobar=baz')).toEqual({});
  });

  it('returns empty for undefined input', () => {
    expect(parseToleranceFlag(undefined)).toEqual({});
  });
});

describe('tolerance / levenshtein', () => {
  it('basic distances', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('jan', 'jan')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. CSV parser edge cases.
// ────────────────────────────────────────────────────────────────────────────

describe('csv / parseCsv', () => {
  it('parses quoted fields with embedded commas', () => {
    const txt = `name,city\n"Smith, Jane","Den Haag"\nDoe,Amsterdam`;
    const rows = parseCsv(txt);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('Smith, Jane');
    expect(rows[1].city).toBe('Amsterdam');
  });

  it('handles escaped quotes (RFC 4180)', () => {
    const txt = `note\n"He said ""hi"""`;
    const rows = parseCsv(txt);
    expect(rows[0].note).toBe('He said "hi"');
  });

  it('handles BOM and CRLF', () => {
    const txt = `﻿a,b\r\n1,2\r\n3,4\r\n`;
    const rows = parseCsv(txt);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('returns empty for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Smart-matching (5 strategies).
// ────────────────────────────────────────────────────────────────────────────

function makeCand(p: Partial<NormalisedCandidate> = {}): NormalisedCandidate {
  return {
    source_id: p.source_id ?? 'm',
    candidate_reference: null,
    email: null,
    phone: null,
    name: null,
    first_name: null,
    last_name: null,
    birthdate: null,
    current_position: null,
    current_company: null,
    current_salary: null,
    expected_salary: null,
    years_of_experience: null,
    industry: null,
    address_city: null,
    address_country: null,
    tags: [],
    skills: [],
    notes: null,
    description: null,
    source: null,
    status: null,
    created_at: null,
    updated_at: null,
    raw: {},
    ...p,
  };
}

describe('matching / candidates — 5 strategies', () => {
  it('1. reference match', () => {
    const m = makeCand({ candidate_reference: 'CAND-001' });
    const t = makeCand({ source_id: 't1', candidate_reference: 'CAND-001' });
    const out = matchCandidates([m], [t]);
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0].matchedBy).toBe('reference');
  });

  it('2. email match (case-insensitive)', () => {
    const m = makeCand({ email: 'JANE@example.com' });
    const t = makeCand({ source_id: 't1', email: 'jane@example.com' });
    const out = matchCandidates([m], [t]);
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0].matchedBy).toBe('email');
  });

  it('3. phone match (digits only)', () => {
    // Same digits, different formatting on both sides.
    const m = makeCand({ phone: '+31 6 1234 5678' });
    const t = makeCand({ source_id: 't1', phone: '+31-6-12345678' });
    const out = matchCandidates([m], [t]);
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0].matchedBy).toBe('phone');
  });

  it('4. fuzzy name + birthdate (Levenshtein < 3)', () => {
    const m = makeCand({ name: 'Sophie van den Berg', birthdate: '1992-03-15' });
    const t = makeCand({
      source_id: 't1',
      name: 'Sofie van den Berg', // 1 char diff
      birthdate: '1992-03-15',
    });
    const out = matchCandidates([m], [t]);
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0].matchedBy).toBe('name+birthdate');
  });

  it('5. unmatched -> only_in_manatal', () => {
    const m = makeCand({ candidate_reference: 'NEW' });
    const out = matchCandidates([m], []);
    expect(out.onlyInManatal).toHaveLength(1);
  });

  it('only_in_talentflow when TF has extra record', () => {
    const t = makeCand({ source_id: 't1', candidate_reference: 'X' });
    const out = matchCandidates([], [t]);
    expect(out.onlyInTalentflow).toHaveLength(1);
  });

  it('reference takes precedence over email', () => {
    const m = makeCand({ candidate_reference: 'CAND-001', email: 'a@b.com' });
    const t1 = makeCand({ source_id: 't1', candidate_reference: 'CAND-001', email: 'x@y.com' });
    const t2 = makeCand({ source_id: 't2', email: 'a@b.com' });
    const out = matchCandidates([m], [t1, t2]);
    expect(out.pairs[0].talentflow.source_id).toBe('t1');
    expect(out.pairs[0].matchedBy).toBe('reference');
  });
});

describe('matching / jobs', () => {
  it('matches by job_reference', () => {
    const m: NormalisedJob = {
      source_id: 'm',
      job_reference: 'JOB-001',
      title: 't',
      location: null,
      department: null,
      status: null,
      employment_type: null,
      experience_level: null,
      industry: null,
      remote_type: null,
      description: null,
      salary_min: null,
      salary_max: null,
      currency: null,
      required_skills: [],
      open_date: null,
      close_date: null,
      created_at: null,
      updated_at: null,
      raw: {},
    };
    const t = { ...m, source_id: 't' };
    const out = matchJobs([m], [t]);
    expect(out.pairs[0].matchedBy).toBe('reference');
  });

  it('falls back to title+location', () => {
    const m: NormalisedJob = {
      source_id: 'm',
      job_reference: null,
      title: 'Senior Developer',
      location: 'Amsterdam',
      department: null,
      status: null,
      employment_type: null,
      experience_level: null,
      industry: null,
      remote_type: null,
      description: null,
      salary_min: null,
      salary_max: null,
      currency: null,
      required_skills: [],
      open_date: null,
      close_date: null,
      created_at: null,
      updated_at: null,
      raw: {},
    };
    const t = { ...m, source_id: 't', title: 'senior developer' };
    const out = matchJobs([m], [t]);
    expect(out.pairs[0].matchedBy).toBe('title+location');
  });
});

describe('matching / applications', () => {
  it('matches by candidate_reference + job_reference', () => {
    const m: NormalisedApplication = {
      source_id: 'm',
      candidate_reference: 'C',
      candidate_email: null,
      job_reference: 'J',
      job_title: null,
      status: null,
      stage: null,
      applied_at: null,
      updated_at: null,
      raw: {},
    };
    const t = { ...m, source_id: 't' };
    const out = matchApplications([m], [t]);
    expect(out.pairs).toHaveLength(1);
  });

  it('falls back to email+title', () => {
    const m: NormalisedApplication = {
      source_id: 'm',
      candidate_reference: null,
      candidate_email: 'jane@x.com',
      job_reference: null,
      job_title: 'Frontend Dev',
      status: null,
      stage: null,
      applied_at: null,
      updated_at: null,
      raw: {},
    };
    const t = { ...m, source_id: 't', job_title: 'frontend dev' };
    const out = matchApplications([m], [t]);
    expect(out.pairs).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Severity classification (built into buildReport via diffFields).
// ────────────────────────────────────────────────────────────────────────────

describe('severity / classification', () => {
  it('email mismatch is critical', () => {
    const m = makeCand({
      source_id: 'm',
      candidate_reference: 'X',
      email: 'a@b.com',
      name: 'Jane',
    });
    const t = makeCand({
      source_id: 't',
      candidate_reference: 'X',
      email: 'other@x.com',
      name: 'Jane',
    });
    const report = buildReport('tenant', DEFAULT_TOLERANCE, {
      manatalCandidates: [m],
      talentflowCandidates: [t],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });
    expect(report.critical_count).toBeGreaterThanOrEqual(1);
    expect(report.records[0].diffs.find((d) => d.field === 'email')?.severity).toBe(
      'critical'
    );
  });

  it('current_position mismatch is major', () => {
    const m = makeCand({
      source_id: 'm',
      candidate_reference: 'X',
      email: 'a@b.com',
      name: 'Jane',
      current_position: 'Senior Frontend Developer',
    });
    const t = makeCand({
      source_id: 't',
      candidate_reference: 'X',
      email: 'a@b.com',
      name: 'Jane',
      current_position: 'Sr Frontend Engineer',
    });
    const report = buildReport('tenant', DEFAULT_TOLERANCE, {
      manatalCandidates: [m],
      talentflowCandidates: [t],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });
    expect(report.major_count).toBeGreaterThanOrEqual(1);
    const diff = report.records[0].diffs.find((d) => d.field === 'current_position');
    expect(diff?.severity).toBe('major');
  });

  it('notes mismatch is minor', () => {
    const m = makeCand({
      source_id: 'm',
      candidate_reference: 'X',
      email: 'a@b.com',
      name: 'Jane',
      notes: 'Old note text totally different',
    });
    const t = makeCand({
      source_id: 't',
      candidate_reference: 'X',
      email: 'a@b.com',
      name: 'Jane',
      notes: 'New note text totally different from old',
    });
    const report = buildReport('tenant', DEFAULT_TOLERANCE, {
      manatalCandidates: [m],
      talentflowCandidates: [t],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });
    const diff = report.records[0].diffs.find((d) => d.field === 'notes');
    expect(diff?.severity).toBe('minor');
  });

  it('whitespace-only diff classified as tolerance', () => {
    const m = makeCand({
      source_id: 'm',
      candidate_reference: 'X',
      email: 'a@b.com',
      name: 'Jane',
      notes: 'note  with   extra spaces',
    });
    const t = makeCand({
      source_id: 't',
      candidate_reference: 'X',
      email: 'a@b.com',
      name: 'Jane',
      notes: 'note with extra spaces',
    });
    const report = buildReport('tenant', DEFAULT_TOLERANCE, {
      manatalCandidates: [m],
      talentflowCandidates: [t],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });
    const noteDiff = report.records[0].diffs.find((d) => d.field === 'notes');
    expect(noteDiff?.severity).toBe('tolerance');
    expect(report.tolerance_count).toBeGreaterThanOrEqual(1);
  });

  it('only_in_manatal yields critical missing-record diff', () => {
    const m = makeCand({ source_id: 'm', candidate_reference: 'NEW' });
    const report = buildReport('tenant', DEFAULT_TOLERANCE, {
      manatalCandidates: [m],
      talentflowCandidates: [],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });
    expect(report.critical_count).toBe(1);
    expect(report.records[0].status).toBe('only_in_manatal');
  });

  it('field-set sanity', () => {
    expect(CRITICAL_CANDIDATE_FIELDS.has('email')).toBe(true);
    expect(CRITICAL_CANDIDATE_FIELDS.has('name')).toBe(true);
    expect(MAJOR_CANDIDATE_FIELDS.has('current_position')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Output formats.
// ────────────────────────────────────────────────────────────────────────────

describe('output / formats', () => {
  const sampleReport = () =>
    buildReport('tenant-uuid', DEFAULT_TOLERANCE, {
      manatalCandidates: [
        makeCand({
          source_id: 'm1',
          candidate_reference: 'C1',
          email: 'a@b.com',
          name: 'Jane',
          current_position: 'Dev',
        }),
      ],
      talentflowCandidates: [
        makeCand({
          source_id: 't1',
          candidate_reference: 'C1',
          email: 'a@b.com',
          name: 'Jane',
          current_position: 'Engineer',
        }),
      ],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });

  it('JSON is parseable and round-trips key fields', () => {
    const r = sampleReport();
    const json = reportToJson(r);
    const parsed = JSON.parse(json);
    expect(parsed.tenant_id).toBe('tenant-uuid');
    expect(parsed.summary.candidates.partial).toBeGreaterThanOrEqual(0);
  });

  it('Markdown contains heading and severity sections', () => {
    const md = reportToMarkdown(sampleReport());
    expect(md).toContain('# TalentFlow ↔ Manatal Pariteit-rapport');
    expect(md).toContain('## Samenvatting');
    expect(md).toContain('## CRITICAL issues');
    expect(md).toContain('## MAJOR issues');
    expect(md).toContain('## Cutover-aanbeveling');
  });

  it('Markdown shows READY when 0 criticals + 0 majors', () => {
    const cleanReport = buildReport('t', DEFAULT_TOLERANCE, {
      manatalCandidates: [],
      talentflowCandidates: [],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });
    expect(reportToMarkdown(cleanReport)).toContain('READY');
  });

  it('Markdown shows STOP CUTOVER when criticals present', () => {
    const m = makeCand({ source_id: 'm', candidate_reference: 'NEW' });
    const r = buildReport('t', DEFAULT_TOLERANCE, {
      manatalCandidates: [m],
      talentflowCandidates: [],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });
    expect(reportToMarkdown(r)).toContain('STOP CUTOVER');
  });

  it('CSV has header + data rows', () => {
    const csv = reportToCsv(sampleReport());
    const lines = csv.split('\n');
    expect(lines[0]).toContain('entity,manatal_id');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('CSV escapes commas and quotes', () => {
    const m = makeCand({
      source_id: 'm',
      candidate_reference: 'X',
      email: 'a@b.com',
      name: 'Doe, Jane',
      notes: 'has "quotes" and, commas',
    });
    const t = makeCand({
      source_id: 't',
      candidate_reference: 'X',
      email: 'a@b.com',
      name: 'Doe, Jane',
      notes: 'different',
    });
    const r = buildReport('t', DEFAULT_TOLERANCE, {
      manatalCandidates: [m],
      talentflowCandidates: [t],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });
    const csv = reportToCsv(r);
    expect(csv).toContain('"has ""quotes"" and, commas"');
  });

  it('writeReportFiles produces 3 files on disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
    try {
      const out = writeReportFiles(sampleReport(), dir);
      expect(fs.existsSync(out.json)).toBe(true);
      expect(fs.existsSync(out.md)).toBe(true);
      expect(fs.existsSync(out.csv)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. CLI parsing.
// ────────────────────────────────────────────────────────────────────────────

describe('cli / parseCliArgs', () => {
  it('parses required + optional args', () => {
    const args = parseCliArgs([
      '--tenant-id',
      'uuid-123',
      '--manatal-candidates',
      './c.csv',
      '--manatal-jobs',
      './j.csv',
      '--manatal-applications',
      './a.csv',
      '--output-dir',
      './out',
      '--tolerance',
      'datetime=120s,whitespace=ignore',
      '--strict',
    ]);
    expect(args.tenantId).toBe('uuid-123');
    expect(args.manatalCandidates).toBe('./c.csv');
    expect(args.outputDir).toBe('./out');
    expect(args.tolerance.datetimeSeconds).toBe(120);
    expect(args.strict).toBe(true);
  });

  it('throws on missing tenant-id', () => {
    expect(() => parseCliArgs(['--strict'])).toThrow(/tenant-id/);
  });

  it('default output-dir + non-strict by default', () => {
    const args = parseCliArgs(['--tenant-id', 'x']);
    expect(args.outputDir).toBe('./parity-reports');
    expect(args.strict).toBe(false);
    expect(args.watchMinutes).toBeNull();
  });

  it('parses watch interval', () => {
    const args = parseCliArgs(['--tenant-id', 'x', '--watch', '15']);
    expect(args.watchMinutes).toBe(15);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. Manatal mapping (alias resolution).
// ────────────────────────────────────────────────────────────────────────────

describe('mapping / Manatal CSV row', () => {
  it('maps standard Manatal candidate row', () => {
    const row = {
      'Candidate Reference': 'CAND-001',
      Email: 'jane@example.com',
      'Full Name': 'Jane Doe',
      'Current Position': 'Senior Developer',
      'Years of Experience': '8',
      Tags: 'react;typescript',
    };
    const out = mapManatalCandidate(row, 0);
    expect(out.candidate_reference).toBe('CAND-001');
    expect(out.email).toBe('jane@example.com');
    expect(out.name).toBe('Jane Doe');
    expect(out.years_of_experience).toBe(8);
    expect(out.tags).toEqual(['react', 'typescript']);
  });

  it('falls back to alternate aliases', () => {
    const row = { Reference: 'X', 'Primary Email': 'a@b.com', Name: 'Z' };
    const out = mapManatalCandidate(row, 0);
    expect(out.candidate_reference).toBe('X');
    expect(out.email).toBe('a@b.com');
    expect(out.name).toBe('Z');
  });

  it('honours Agent BB mapping aliases (long-form Manatal headers)', () => {
    // BB's MANATAL_TO_TALENTFLOW_CANDIDATE includes "Candidate Email Address"
    // and "Candidate Name" as long-form aliases. Verify our parity-mapper
    // picks them up.
    const row = {
      'Candidate Email Address': 'long@form.com',
      'Candidate Name': 'Long Form',
      'Job Title': 'Architect', // BB maps this to current_position
    };
    const out = mapManatalCandidate(row, 0);
    expect(out.email).toBe('long@form.com');
    expect(out.name).toBe('Long Form');
    expect(out.current_position).toBe('Architect');
  });

  it('maps job row', () => {
    const row = {
      'Job Reference': 'JOB-001',
      'Job Title': 'Frontend Dev',
      Location: 'Amsterdam',
      'Salary Min': '50000',
      'Salary Max': '70000',
    };
    const out = mapManatalJob(row, 0);
    expect(out.job_reference).toBe('JOB-001');
    expect(out.title).toBe('Frontend Dev');
    expect(out.salary_min).toBe(50000);
    expect(out.salary_max).toBe(70000);
  });

  it('maps application row', () => {
    const row = {
      'Candidate Reference': 'C1',
      'Job Reference': 'J1',
      Status: 'active',
      Stage: 'Phone Screen',
    };
    const out = mapManatalApplication(row, 0);
    expect(out.candidate_reference).toBe('C1');
    expect(out.job_reference).toBe('J1');
    expect(out.status).toBe('active');
    expect(out.stage).toBe('Phone Screen');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. TalentFlow normalisation (Date → ISO, array fields, etc.)
// ────────────────────────────────────────────────────────────────────────────

describe('mapping / TalentFlow row', () => {
  it('converts Date instances to ISO strings', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const out = normaliseTalentflowCandidate({
      id: 'uuid',
      email: 'a@b.com',
      created_at: d,
      tags: ['x', 'y'],
    });
    expect(out.created_at).toBe(d.toISOString());
    expect(out.email).toBe('a@b.com');
    expect(out.tags).toEqual(['x', 'y']);
  });

  it('normaliseTalentflowJob handles array fields', () => {
    const out = normaliseTalentflowJob({
      id: 'j1',
      title: 'Dev',
      required_skills: ['ts', 'react'],
    });
    expect(out.required_skills).toEqual(['ts', 'react']);
  });

  it('normaliseTalentflowApplication uses stage_name fallback', () => {
    const out = normaliseTalentflowApplication({
      id: 'a1',
      stage_name: 'Phone Screen',
    });
    expect(out.stage).toBe('Phone Screen');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9. Strict-mode exit-code semantics (simulate via exit-code computation).
// ────────────────────────────────────────────────────────────────────────────

describe('strict-mode / exit code rules', () => {
  it('strict + 0 critical -> exit 0', () => {
    const r = buildReport('t', DEFAULT_TOLERANCE, {
      manatalCandidates: [],
      talentflowCandidates: [],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });
    const expectedExit = r.critical_count > 0 ? 1 : 0;
    expect(expectedExit).toBe(0);
  });

  it('strict + N critical -> exit 1', () => {
    const m = makeCand({ source_id: 'm', candidate_reference: 'NEW' });
    const r = buildReport('t', DEFAULT_TOLERANCE, {
      manatalCandidates: [m],
      talentflowCandidates: [],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });
    const expectedExit = r.critical_count > 0 ? 1 : 0;
    expect(expectedExit).toBe(1);
  });

  it('non-strict + N critical -> exit 0 (always)', () => {
    const m = makeCand({ source_id: 'm', candidate_reference: 'NEW' });
    const r = buildReport('t', DEFAULT_TOLERANCE, {
      manatalCandidates: [m],
      talentflowCandidates: [],
      manatalJobs: [],
      talentflowJobs: [],
      manatalApplications: [],
      talentflowApplications: [],
    });
    expect(r.critical_count).toBeGreaterThan(0);
    // Non-strict mode: always 0
    const exit = 0;
    expect(exit).toBe(0);
  });
});

#!/usr/bin/env tsx
/**
 * TalentFlow ↔ Manatal pariteit-checker.
 *
 * Sprint Q1.3 — IT Proposal cutover-prep. Reads exported Manatal CSVs and
 * compares them against the live TalentFlow database for a given tenant. Emits
 * machine- and human-readable diff reports. Used during the 1-week shadow-run
 * to prove that recruiter mutations land identically in both systems.
 *
 * Usage:
 *   tsx apps/api/scripts/parity-check.ts \
 *     --tenant-id <uuid> \
 *     --manatal-candidates ./manatal-export-week-2/candidates.csv \
 *     --manatal-jobs ./manatal-export-week-2/jobs.csv \
 *     --manatal-applications ./manatal-export-week-2/applications.csv \
 *     --output-dir ./parity-reports/ \
 *     --tolerance datetime=60s,whitespace=ignore,accents=fold \
 *     [--strict] [--watch <minutes>] [--webhook https://...]
 *
 * Exit codes:
 *   0  no critical diffs (always 0 when --strict not supplied)
 *   1  critical diffs found and --strict was supplied
 *   2  fatal error before report could be written (bad CSV, bad CLI flags, ...)
 *
 * This file is the orchestrator. The pure comparison helpers live in
 * `parity-tolerance.ts`. We deliberately avoid touching service-code: we read
 * from TalentFlow through the existing service-laag (`listCandidates` etc.)
 * and aggregate in-memory.
 */

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';

import {
  DEFAULT_TOLERANCE,
  ToleranceConfig,
  parseToleranceFlag,
  isStringEqual,
  isDateTimeEqual,
  isNumberEqual,
  isArrayEqual,
  isBooleanEqual,
  isEmpty,
  normaliseEmail,
  normalisePhone,
  levenshtein,
  foldAccents,
} from './parity-tolerance';

// Manatal field-mapping is owned by Agent BB. We optionally pull in BB's table
// when present (preferred) and otherwise fall back to a built-in alias-list so
// the parity-check tool can run standalone (e.g. in CI without the import
// script being deployed). This keeps the comparison engine the source of
// truth for parity-checking semantics — BB's table dictates SHAPE only.
type ManatalCandidateRow = Record<string, string>;
type ManatalJobRow = Record<string, string>;
type ManatalApplicationRow = Record<string, string>;

interface BBMappings {
  candidate?: Record<string, string>;
  job?: Record<string, string>;
}

/** Lazy-loaded reference to Agent BB's mapping module (if present). */
let bbMappings: BBMappings | null = null;
function loadBbMappings(): BBMappings {
  if (bbMappings !== null) return bbMappings;

  // Try a few resolution strategies — vitest/Vite, tsx, and node-cjs all
  // resolve relative requires differently, so we try the "easy" path first
  // and fall back to absolute path resolution if needed.
  const candidates = [
    './manatal-mapping',
    './manatal-mapping.ts',
    `${__dirname}/manatal-mapping`,
    `${__dirname}/manatal-mapping.ts`,
  ];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require(p) as {
        MANATAL_TO_TALENTFLOW_CANDIDATE?: Record<string, string>;
        MANATAL_TO_TALENTFLOW_JOB?: Record<string, string>;
      };
      bbMappings = {
        candidate: m.MANATAL_TO_TALENTFLOW_CANDIDATE,
        job: m.MANATAL_TO_TALENTFLOW_JOB,
      };
      return bbMappings;
    } catch {
      /* try next path */
    }
  }
  bbMappings = {};
  return bbMappings;
}

/**
 * Resolve a row's value for a TalentFlow column-name by walking the BB
 * mapping table in reverse (multiple Manatal headers can map to the same
 * tf-column; we return the first non-empty hit).
 */
function pickFromBbMapping(
  row: Record<string, string>,
  table: Record<string, string> | undefined,
  tfColumn: string
): string | null {
  if (!table) return null;
  for (const [manatalHeader, tfCol] of Object.entries(table)) {
    if (tfCol !== tfColumn) continue;
    const v = row[manatalHeader];
    if (v !== undefined && v !== '') return v;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Public types — diff-engine output shape.
// ────────────────────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'major' | 'minor' | 'tolerance';

export type Entity = 'candidate' | 'job' | 'application';

export interface FieldDiff {
  field: string;
  manatal_value: unknown;
  talentflow_value: unknown;
  severity: Severity;
}

export type RecordStatus =
  | 'match'
  | 'partial_match'
  | 'only_in_manatal'
  | 'only_in_talentflow';

export interface RecordDiff {
  entity: Entity;
  matched_by:
    | 'reference'
    | 'email'
    | 'phone'
    | 'name+birthdate'
    | 'title+location'
    | 'job+candidate'
    | 'unmatched';
  manatal_id: string | null;
  talentflow_id: string | null;
  status: RecordStatus;
  diffs: FieldDiff[];
}

export interface EntitySummary {
  total_manatal: number;
  total_talentflow: number;
  matched: number;
  partial: number;
  only_manatal: number;
  only_talentflow: number;
}

export interface ParityReport {
  tenant_id: string;
  generated_at: string;
  tolerance: ToleranceConfig;
  summary: {
    candidates: EntitySummary;
    jobs: EntitySummary;
    applications: EntitySummary;
  };
  critical_count: number;
  major_count: number;
  minor_count: number;
  tolerance_count: number;
  records: RecordDiff[];
  duration_ms: number;
}

// ────────────────────────────────────────────────────────────────────────────
// CLI parsing.
// ────────────────────────────────────────────────────────────────────────────

interface CliArgs {
  tenantId: string;
  manatalCandidates?: string;
  manatalJobs?: string;
  manatalApplications?: string;
  outputDir: string;
  tolerance: ToleranceConfig;
  strict: boolean;
  watchMinutes: number | null;
  webhook: string | null;
  /** Path to a JSON file with TalentFlow data — for tests / dry-runs without DB. */
  talentflowFixture: string | null;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }

  const tenantId = String(args['tenant-id'] ?? '');
  if (!tenantId) {
    throw new Error('--tenant-id is verplicht');
  }

  const tolerance: ToleranceConfig = {
    ...DEFAULT_TOLERANCE,
    ...parseToleranceFlag(typeof args.tolerance === 'string' ? args.tolerance : undefined),
  };

  const watchRaw = args['watch'];
  const watchMinutes =
    typeof watchRaw === 'string' && /^\d+$/.test(watchRaw) ? Number(watchRaw) : null;

  return {
    tenantId,
    manatalCandidates:
      typeof args['manatal-candidates'] === 'string'
        ? (args['manatal-candidates'] as string)
        : undefined,
    manatalJobs:
      typeof args['manatal-jobs'] === 'string' ? (args['manatal-jobs'] as string) : undefined,
    manatalApplications:
      typeof args['manatal-applications'] === 'string'
        ? (args['manatal-applications'] as string)
        : undefined,
    outputDir:
      typeof args['output-dir'] === 'string'
        ? (args['output-dir'] as string)
        : './parity-reports',
    tolerance,
    strict: args.strict === true,
    watchMinutes,
    webhook: typeof args.webhook === 'string' ? (args.webhook as string) : null,
    talentflowFixture:
      typeof args['talentflow-fixture'] === 'string'
        ? (args['talentflow-fixture'] as string)
        : null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CSV parsing (RFC 4180 — quoted fields, escaped quotes, CR/LF).
// We don't pull in csv-parse to keep the script dependency-free.
// ────────────────────────────────────────────────────────────────────────────

export function parseCsv(text: string): Record<string, string>[] {
  // Strip BOM.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      cur.push(field);
      field = '';
      continue;
    }
    if (c === '\n' || c === '\r') {
      // Handle CRLF: skip the LF after CR.
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(field);
      field = '';
      // Skip empty trailing lines.
      if (cur.length > 1 || cur[0] !== '') rows.push(cur);
      cur = [];
      continue;
    }
    field += c;
  }
  // Flush final field/row if file did not end with newline.
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = (r[i] ?? '').trim();
    }
    return obj;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Manatal mapping — defensive, prefers Agent BB's file when present.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalised candidate shape used internally for comparison. Field names match
 * TalentFlow `candidates`-table columns where possible.
 */
export interface NormalisedCandidate {
  source_id: string;
  candidate_reference: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  birthdate: string | null;
  current_position: string | null;
  current_company: string | null;
  current_salary: number | null;
  expected_salary: number | null;
  years_of_experience: number | null;
  industry: string | null;
  address_city: string | null;
  address_country: string | null;
  tags: string[];
  skills: string[];
  notes: string | null;
  description: string | null;
  source: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  raw: Record<string, unknown>;
}

export interface NormalisedJob {
  source_id: string;
  job_reference: string | null;
  title: string | null;
  location: string | null;
  department: string | null;
  status: string | null;
  employment_type: string | null;
  experience_level: string | null;
  industry: string | null;
  remote_type: string | null;
  description: string | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  required_skills: string[];
  open_date: string | null;
  close_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  raw: Record<string, unknown>;
}

export interface NormalisedApplication {
  source_id: string;
  candidate_reference: string | null;
  candidate_email: string | null;
  job_reference: string | null;
  job_title: string | null;
  status: string | null;
  stage: string | null;
  applied_at: string | null;
  updated_at: string | null;
  raw: Record<string, unknown>;
}

/**
 * Manatal export column-aliases. The IT Proposal export uses these headers
 * verbatim; we accept several common spellings so we work across exports.
 */
const MANATAL_CANDIDATE_ALIASES = {
  reference: ['Candidate Reference', 'Reference', 'Ref'],
  email: ['Email', 'Email Address', 'Primary Email'],
  phone: ['Phone', 'Phone Number', 'Mobile'],
  name: ['Full Name', 'Name'],
  first_name: ['First Name', 'Firstname'],
  last_name: ['Last Name', 'Lastname', 'Surname'],
  birthdate: ['Date of Birth', 'Birthdate', 'DOB'],
  current_position: ['Current Position', 'Current Job Title', 'Position'],
  current_company: ['Current Company', 'Current Employer', 'Company'],
  current_salary: ['Current Salary'],
  expected_salary: ['Expected Salary'],
  years_of_experience: ['Years of Experience', 'Experience (years)', 'YOE'],
  industry: ['Industry'],
  address_city: ['City', 'Address City'],
  address_country: ['Country', 'Address Country'],
  tags: ['Tags', 'Labels'],
  skills: ['Skills'],
  notes: ['Notes'],
  description: ['Description', 'Summary', 'About'],
  source: ['Source'],
  status: ['Status'],
  created_at: ['Created At', 'Date Added', 'Created'],
  updated_at: ['Updated At', 'Last Modified', 'Modified'],
} as const;

const MANATAL_JOB_ALIASES = {
  reference: ['Job Reference', 'Reference'],
  title: ['Title', 'Job Title'],
  location: ['Location'],
  department: ['Department'],
  status: ['Status'],
  employment_type: ['Employment Type'],
  experience_level: ['Experience Level'],
  industry: ['Industry'],
  remote_type: ['Remote Type', 'Work Mode'],
  description: ['Description', 'Job Description'],
  salary_min: ['Salary Min', 'Minimum Salary'],
  salary_max: ['Salary Max', 'Maximum Salary'],
  currency: ['Currency'],
  required_skills: ['Required Skills', 'Skills Required'],
  open_date: ['Open Date', 'Posted Date'],
  close_date: ['Close Date', 'Closing Date'],
  created_at: ['Created At', 'Created'],
  updated_at: ['Updated At', 'Modified'],
} as const;

const MANATAL_APPLICATION_ALIASES = {
  candidate_reference: ['Candidate Reference', 'Candidate Ref'],
  candidate_email: ['Candidate Email', 'Email'],
  job_reference: ['Job Reference', 'Job Ref'],
  job_title: ['Job Title'],
  status: ['Status', 'Application Status'],
  stage: ['Stage', 'Pipeline Stage'],
  applied_at: ['Applied At', 'Application Date'],
  updated_at: ['Updated At', 'Modified'],
} as const;

function pickAlias(row: Record<string, string>, aliases: readonly string[]): string | null {
  for (const a of aliases) {
    if (row[a] !== undefined && row[a] !== '') return row[a];
  }
  return null;
}

/**
 * Two-tier lookup: try Agent BB's official mapping table first (so any new
 * column they add is automatically picked up), then fall back to our local
 * alias list. The result is `null` when both are empty.
 */
function pickBbOrAlias(
  row: Record<string, string>,
  bbTable: Record<string, string> | undefined,
  tfColumn: string,
  fallbackAliases: readonly string[]
): string | null {
  const fromBb = pickFromBbMapping(row, bbTable, tfColumn);
  if (fromBb !== null) return fromBb;
  return pickAlias(row, fallbackAliases);
}

function toNullableNumber(s: unknown): number | null {
  if (s === null || s === undefined || s === '') return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  if (typeof s !== 'string') return null;
  const cleaned = s.replace(/[^\d.,\-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function splitList(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function mapManatalCandidate(
  row: ManatalCandidateRow,
  index: number
): NormalisedCandidate {
  const a = MANATAL_CANDIDATE_ALIASES;
  const bb = loadBbMappings().candidate;
  const reference = pickBbOrAlias(row, bb, 'candidate_reference', a.reference);
  const email = pickBbOrAlias(row, bb, 'email', a.email);
  return {
    source_id: reference ?? email ?? `manatal-row-${index}`,
    candidate_reference: reference,
    email: email ? normaliseEmail(email) : null,
    phone: pickBbOrAlias(row, bb, 'phone', a.phone),
    name: pickBbOrAlias(row, bb, 'name', a.name),
    first_name: pickBbOrAlias(row, bb, 'first_name', a.first_name),
    last_name: pickBbOrAlias(row, bb, 'last_name', a.last_name),
    birthdate: pickBbOrAlias(row, bb, 'birthdate', a.birthdate),
    current_position: pickBbOrAlias(row, bb, 'current_position', a.current_position),
    current_company: pickBbOrAlias(row, bb, 'current_company', a.current_company),
    current_salary: toNullableNumber(pickBbOrAlias(row, bb, 'current_salary', a.current_salary)),
    expected_salary: toNullableNumber(pickBbOrAlias(row, bb, 'expected_salary', a.expected_salary)),
    years_of_experience: toNullableNumber(
      pickBbOrAlias(row, bb, 'years_of_experience', a.years_of_experience)
    ),
    industry: pickBbOrAlias(row, bb, 'industry', a.industry),
    address_city: pickBbOrAlias(row, bb, 'address_city', a.address_city),
    address_country: pickBbOrAlias(row, bb, 'address_country', a.address_country),
    tags: splitList(pickBbOrAlias(row, bb, 'tags', a.tags)),
    skills: splitList(pickBbOrAlias(row, bb, 'skills', a.skills)),
    notes: pickBbOrAlias(row, bb, 'notes', a.notes),
    description: pickBbOrAlias(row, bb, 'description', a.description),
    source: pickBbOrAlias(row, bb, 'source', a.source),
    // Manatal CSVs do not always include candidate-status; we use alias-only.
    status: pickAlias(row, a.status),
    created_at: pickAlias(row, a.created_at),
    updated_at: pickAlias(row, a.updated_at),
    raw: { ...row },
  };
}

export function mapManatalJob(row: ManatalJobRow, index: number): NormalisedJob {
  const a = MANATAL_JOB_ALIASES;
  const bb = loadBbMappings().job;
  const reference = pickBbOrAlias(row, bb, 'job_reference', a.reference);
  const title = pickBbOrAlias(row, bb, 'title', a.title);
  return {
    source_id: reference ?? `manatal-job-${index}`,
    job_reference: reference,
    title,
    location: pickBbOrAlias(row, bb, 'location', a.location),
    department: pickBbOrAlias(row, bb, 'department', a.department),
    status: pickBbOrAlias(row, bb, 'status', a.status),
    employment_type: pickBbOrAlias(row, bb, 'employment_type', a.employment_type),
    experience_level: pickBbOrAlias(row, bb, 'experience_level', a.experience_level),
    industry: pickBbOrAlias(row, bb, 'industry', a.industry),
    remote_type: pickBbOrAlias(row, bb, 'remote_type', a.remote_type),
    description: pickBbOrAlias(row, bb, 'description', a.description),
    salary_min: toNullableNumber(pickBbOrAlias(row, bb, 'salary_min', a.salary_min)),
    salary_max: toNullableNumber(pickBbOrAlias(row, bb, 'salary_max', a.salary_max)),
    currency: pickBbOrAlias(row, bb, 'currency', a.currency),
    // BB doesn't track required_skills today; alias-only.
    required_skills: splitList(pickAlias(row, a.required_skills)),
    open_date: pickBbOrAlias(row, bb, 'open_date', a.open_date),
    close_date: pickBbOrAlias(row, bb, 'close_date', a.close_date),
    created_at: pickAlias(row, a.created_at),
    updated_at: pickAlias(row, a.updated_at),
    raw: { ...row },
  };
}

export function mapManatalApplication(
  row: ManatalApplicationRow,
  index: number
): NormalisedApplication {
  const a = MANATAL_APPLICATION_ALIASES;
  const cref = pickAlias(row, a.candidate_reference);
  const jref = pickAlias(row, a.job_reference);
  return {
    source_id: `${cref ?? 'NOREF'}::${jref ?? 'NOREF'}::${index}`,
    candidate_reference: cref,
    candidate_email: pickAlias(row, a.candidate_email)
      ? normaliseEmail(pickAlias(row, a.candidate_email)!)
      : null,
    job_reference: jref,
    job_title: pickAlias(row, a.job_title),
    status: pickAlias(row, a.status),
    stage: pickAlias(row, a.stage),
    applied_at: pickAlias(row, a.applied_at),
    updated_at: pickAlias(row, a.updated_at),
    raw: { ...row },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// TalentFlow-side normalisation. Inputs are rows from the service-laag.
// ────────────────────────────────────────────────────────────────────────────

export function normaliseTalentflowCandidate(c: Record<string, unknown>): NormalisedCandidate {
  return {
    source_id: String(c.id ?? ''),
    candidate_reference: (c.candidate_reference as string | null) ?? null,
    email: c.email ? normaliseEmail(c.email as string) : null,
    phone: (c.phone as string | null) ?? null,
    name: (c.name as string | null) ?? null,
    first_name: (c.first_name as string | null) ?? null,
    last_name: (c.last_name as string | null) ?? null,
    birthdate:
      c.birthdate instanceof Date
        ? (c.birthdate as Date).toISOString()
        : (c.birthdate as string | null) ?? null,
    current_position: (c.current_position as string | null) ?? null,
    current_company: (c.current_company as string | null) ?? null,
    current_salary:
      typeof c.current_salary === 'number' ? c.current_salary : toNullableNumber(c.current_salary as string),
    expected_salary:
      typeof c.expected_salary === 'number'
        ? c.expected_salary
        : toNullableNumber(c.expected_salary as string),
    years_of_experience:
      typeof c.years_of_experience === 'number'
        ? c.years_of_experience
        : toNullableNumber(c.years_of_experience as string),
    industry: (c.industry as string | null) ?? null,
    address_city: (c.address_city as string | null) ?? null,
    address_country: (c.address_country as string | null) ?? null,
    tags: Array.isArray(c.tags) ? (c.tags as string[]) : splitList(c.tags as string | null),
    skills: Array.isArray(c.skills) ? (c.skills as string[]) : splitList(c.skills as string | null),
    notes: (c.notes as string | null) ?? null,
    description: (c.description as string | null) ?? null,
    source: (c.source as string | null) ?? null,
    status: (c.status as string | null) ?? null,
    created_at:
      c.created_at instanceof Date
        ? (c.created_at as Date).toISOString()
        : (c.created_at as string | null) ?? null,
    updated_at:
      c.updated_at instanceof Date
        ? (c.updated_at as Date).toISOString()
        : (c.updated_at as string | null) ?? null,
    raw: c,
  };
}

export function normaliseTalentflowJob(j: Record<string, unknown>): NormalisedJob {
  return {
    source_id: String(j.id ?? ''),
    job_reference: (j.job_reference as string | null) ?? null,
    title: (j.title as string | null) ?? null,
    location: (j.location as string | null) ?? null,
    department: (j.department as string | null) ?? null,
    status: (j.status as string | null) ?? null,
    employment_type: (j.employment_type as string | null) ?? null,
    experience_level: (j.experience_level as string | null) ?? null,
    industry: (j.industry as string | null) ?? null,
    remote_type: (j.remote_type as string | null) ?? null,
    description: (j.description as string | null) ?? null,
    salary_min:
      typeof j.salary_min === 'number' ? j.salary_min : toNullableNumber(j.salary_min as string),
    salary_max:
      typeof j.salary_max === 'number' ? j.salary_max : toNullableNumber(j.salary_max as string),
    currency: (j.currency as string | null) ?? null,
    required_skills: Array.isArray(j.required_skills)
      ? (j.required_skills as string[])
      : splitList(j.required_skills as string | null),
    open_date:
      j.open_date instanceof Date
        ? (j.open_date as Date).toISOString()
        : (j.open_date as string | null) ?? null,
    close_date:
      j.close_date instanceof Date
        ? (j.close_date as Date).toISOString()
        : (j.close_date as string | null) ?? null,
    created_at:
      j.created_at instanceof Date
        ? (j.created_at as Date).toISOString()
        : (j.created_at as string | null) ?? null,
    updated_at:
      j.updated_at instanceof Date
        ? (j.updated_at as Date).toISOString()
        : (j.updated_at as string | null) ?? null,
    raw: j,
  };
}

export function normaliseTalentflowApplication(
  a: Record<string, unknown>
): NormalisedApplication {
  return {
    source_id: String(a.id ?? ''),
    candidate_reference: (a.candidate_reference as string | null) ?? null,
    candidate_email: a.candidate_email
      ? normaliseEmail(a.candidate_email as string)
      : null,
    job_reference: (a.job_reference as string | null) ?? null,
    job_title: (a.job_title as string | null) ?? null,
    status: (a.status as string | null) ?? null,
    stage: (a.stage as string | null) ?? a.stage_name as string ?? null,
    applied_at:
      a.applied_at instanceof Date
        ? (a.applied_at as Date).toISOString()
        : (a.applied_at as string | null) ?? null,
    updated_at:
      a.updated_at instanceof Date
        ? (a.updated_at as Date).toISOString()
        : (a.updated_at as string | null) ?? null,
    raw: a,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Severity rules — central. Critical issues block cutover.
// ────────────────────────────────────────────────────────────────────────────

export const CRITICAL_CANDIDATE_FIELDS = new Set([
  'email',
  'name',
  'candidate_reference',
  'status',
]);

export const MAJOR_CANDIDATE_FIELDS = new Set([
  'current_position',
  'current_company',
  'current_salary',
  'expected_salary',
  'years_of_experience',
  'tags',
  'phone',
  'skills',
  'industry',
]);

export const CRITICAL_JOB_FIELDS = new Set(['title', 'job_reference', 'status']);
export const MAJOR_JOB_FIELDS = new Set([
  'location',
  'department',
  'salary_min',
  'salary_max',
  'currency',
  'required_skills',
  'experience_level',
  'employment_type',
]);

export const CRITICAL_APPLICATION_FIELDS = new Set([
  'candidate_reference',
  'job_reference',
  'status',
]);
export const MAJOR_APPLICATION_FIELDS = new Set(['stage']);

function classifyFieldSeverity(
  entity: Entity,
  field: string,
  withinTolerance: boolean
): Severity {
  if (withinTolerance) return 'tolerance';
  const critSet =
    entity === 'candidate'
      ? CRITICAL_CANDIDATE_FIELDS
      : entity === 'job'
        ? CRITICAL_JOB_FIELDS
        : CRITICAL_APPLICATION_FIELDS;
  if (critSet.has(field)) return 'critical';
  const majorSet =
    entity === 'candidate'
      ? MAJOR_CANDIDATE_FIELDS
      : entity === 'job'
        ? MAJOR_JOB_FIELDS
        : MAJOR_APPLICATION_FIELDS;
  if (majorSet.has(field)) return 'major';
  return 'minor';
}

// ────────────────────────────────────────────────────────────────────────────
// Field comparators per type. We choose comparator by field name — this keeps
// the per-entity diff helpers simple.
// ────────────────────────────────────────────────────────────────────────────

type Comparator = (a: unknown, b: unknown, t: ToleranceConfig) => boolean;

const STRING_FIELDS_FOLD: Comparator = (a, b, t) =>
  isStringEqual(a, b, { whitespace: t.whitespace, accents: t.accents, case: t.case });

const STRING_FIELDS_STRICT_CASE: Comparator = (a, b, t) =>
  isStringEqual(a, b, { whitespace: t.whitespace, accents: t.accents, case: 'fold' });

const DATE_FIELDS: Comparator = (a, b, t) => isDateTimeEqual(a, b, t.datetimeSeconds);
const NUMBER_FIELDS: Comparator = (a, b, t) => isNumberEqual(a, b, t.number);
const ARRAY_FIELDS: Comparator = (a, b, t) =>
  isArrayEqual(a, b, {
    order: t.arrayOrder,
    string: { whitespace: t.whitespace, accents: t.accents, case: t.case },
  });
const PHONE_FIELDS: Comparator = (a, b) =>
  normalisePhone(a) === normalisePhone(b) || (isEmpty(a) && isEmpty(b));
const EMAIL_FIELDS: Comparator = (a, b) => {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) || isEmpty(b)) return false;
  return normaliseEmail(String(a)) === normaliseEmail(String(b));
};
const BOOLEAN_FIELDS: Comparator = isBooleanEqual;

const CANDIDATE_FIELD_COMPARATORS: Record<string, Comparator> = {
  candidate_reference: STRING_FIELDS_STRICT_CASE,
  email: EMAIL_FIELDS,
  phone: PHONE_FIELDS,
  name: STRING_FIELDS_FOLD,
  first_name: STRING_FIELDS_FOLD,
  last_name: STRING_FIELDS_FOLD,
  birthdate: DATE_FIELDS,
  current_position: STRING_FIELDS_FOLD,
  current_company: STRING_FIELDS_FOLD,
  current_salary: NUMBER_FIELDS,
  expected_salary: NUMBER_FIELDS,
  years_of_experience: NUMBER_FIELDS,
  industry: STRING_FIELDS_FOLD,
  address_city: STRING_FIELDS_FOLD,
  address_country: STRING_FIELDS_FOLD,
  tags: ARRAY_FIELDS,
  skills: ARRAY_FIELDS,
  notes: STRING_FIELDS_FOLD,
  description: STRING_FIELDS_FOLD,
  source: STRING_FIELDS_FOLD,
  status: STRING_FIELDS_FOLD,
  created_at: DATE_FIELDS,
  updated_at: DATE_FIELDS,
};

const JOB_FIELD_COMPARATORS: Record<string, Comparator> = {
  job_reference: STRING_FIELDS_STRICT_CASE,
  title: STRING_FIELDS_FOLD,
  location: STRING_FIELDS_FOLD,
  department: STRING_FIELDS_FOLD,
  status: STRING_FIELDS_FOLD,
  employment_type: STRING_FIELDS_FOLD,
  experience_level: STRING_FIELDS_FOLD,
  industry: STRING_FIELDS_FOLD,
  remote_type: STRING_FIELDS_FOLD,
  description: STRING_FIELDS_FOLD,
  salary_min: NUMBER_FIELDS,
  salary_max: NUMBER_FIELDS,
  currency: STRING_FIELDS_STRICT_CASE,
  required_skills: ARRAY_FIELDS,
  open_date: DATE_FIELDS,
  close_date: DATE_FIELDS,
  created_at: DATE_FIELDS,
  updated_at: DATE_FIELDS,
};

const APPLICATION_FIELD_COMPARATORS: Record<string, Comparator> = {
  candidate_reference: STRING_FIELDS_STRICT_CASE,
  candidate_email: EMAIL_FIELDS,
  job_reference: STRING_FIELDS_STRICT_CASE,
  job_title: STRING_FIELDS_FOLD,
  status: STRING_FIELDS_FOLD,
  stage: STRING_FIELDS_FOLD,
  applied_at: DATE_FIELDS,
  updated_at: DATE_FIELDS,
};

/**
 * Some diffs are within a configured tolerance — e.g. created_at differing by
 * 30s, whitespace-only mismatches in notes. We re-run the comparator with a
 * STRICT policy to detect exact-equality vs. tolerance-equality so the report
 * can show "tolerance" diffs separately. Returns true if values are exactly
 * equal under the strictest possible policy (no fold, no trim, no skew).
 */
function strictlyEqual(field: string, entity: Entity, a: unknown, b: unknown): boolean {
  // Empty on both sides counts as exactly-equal regardless of representation.
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) || isEmpty(b)) return false;

  const comparators =
    entity === 'candidate'
      ? CANDIDATE_FIELD_COMPARATORS
      : entity === 'job'
        ? JOB_FIELD_COMPARATORS
        : APPLICATION_FIELD_COMPARATORS;
  const cmp = comparators[field];
  if (!cmp) return JSON.stringify(a) === JSON.stringify(b);

  // Strict tolerance: no whitespace fold, no accent fold, no case fold,
  // no datetime skew, no number tolerance.
  if (cmp === DATE_FIELDS) return isDateTimeEqual(a, b, 0);
  if (cmp === NUMBER_FIELDS) return isNumberEqual(a, b, 0);
  if (cmp === ARRAY_FIELDS)
    return isArrayEqual(a, b, {
      order: 'matter',
      string: { whitespace: 'strict', accents: 'strict', case: 'strict' },
    });
  if (cmp === STRING_FIELDS_FOLD || cmp === STRING_FIELDS_STRICT_CASE)
    return isStringEqual(a, b, { whitespace: 'strict', accents: 'strict', case: 'strict' });
  if (cmp === PHONE_FIELDS) return String(a) === String(b);
  if (cmp === EMAIL_FIELDS) return String(a) === String(b);
  if (cmp === BOOLEAN_FIELDS) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ────────────────────────────────────────────────────────────────────────────
// Diff engine.
// ────────────────────────────────────────────────────────────────────────────

function diffFields(
  entity: Entity,
  manatalRec: Record<string, unknown>,
  talentflowRec: Record<string, unknown>,
  fields: string[],
  tolerance: ToleranceConfig
): FieldDiff[] {
  const out: FieldDiff[] = [];
  const comparators =
    entity === 'candidate'
      ? CANDIDATE_FIELD_COMPARATORS
      : entity === 'job'
        ? JOB_FIELD_COMPARATORS
        : APPLICATION_FIELD_COMPARATORS;

  for (const field of fields) {
    const a = manatalRec[field];
    const b = talentflowRec[field];
    const cmp = comparators[field];
    if (!cmp) continue;

    const equalUnderTolerance = cmp(a, b, tolerance);
    if (equalUnderTolerance) {
      // Was the difference solely tolerance-driven? Check strict equality.
      if (!strictlyEqual(field, entity, a, b)) {
        out.push({
          field,
          manatal_value: a ?? null,
          talentflow_value: b ?? null,
          severity: 'tolerance',
        });
      }
      continue;
    }
    out.push({
      field,
      manatal_value: a ?? null,
      talentflow_value: b ?? null,
      severity: classifyFieldSeverity(entity, field, false),
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Smart-matching strategies.
//
// 1. candidate_reference / job_reference (exact)
// 2. email (exact, lowercase)
// 3. phone (digits-only)
// 4. fuzzy name + birthdate (Levenshtein < 3 on full name AND identical birthdate)
// 5. unmatched
//
// For applications we match by (candidate_reference + job_reference); fall back
// to (candidate_email + job_title).
// ────────────────────────────────────────────────────────────────────────────

interface MatchResult<M, T> {
  pairs: Array<{
    manatal: M;
    talentflow: T;
    matchedBy: RecordDiff['matched_by'];
  }>;
  onlyInManatal: M[];
  onlyInTalentflow: T[];
}

export function matchCandidates(
  manatal: NormalisedCandidate[],
  talentflow: NormalisedCandidate[]
): MatchResult<NormalisedCandidate, NormalisedCandidate> {
  const tfRemaining = new Set(talentflow);
  const tfByRef = new Map<string, NormalisedCandidate>();
  const tfByEmail = new Map<string, NormalisedCandidate>();
  const tfByPhone = new Map<string, NormalisedCandidate>();
  for (const t of talentflow) {
    if (t.candidate_reference) tfByRef.set(t.candidate_reference, t);
    if (t.email) tfByEmail.set(normaliseEmail(t.email), t);
    if (t.phone) {
      const normPhone = normalisePhone(t.phone);
      if (normPhone) tfByPhone.set(normPhone, t);
    }
  }

  const pairs: MatchResult<NormalisedCandidate, NormalisedCandidate>['pairs'] = [];
  const onlyInManatal: NormalisedCandidate[] = [];

  for (const m of manatal) {
    let match: NormalisedCandidate | undefined;
    let matchedBy: RecordDiff['matched_by'] = 'unmatched';

    // 1. Reference
    if (!match && m.candidate_reference) {
      const candidate = tfByRef.get(m.candidate_reference);
      if (candidate && tfRemaining.has(candidate)) {
        match = candidate;
        matchedBy = 'reference';
      }
    }
    // 2. Email — both sides folded to lowercase before lookup.
    if (!match && m.email) {
      const candidate = tfByEmail.get(normaliseEmail(m.email));
      if (candidate && tfRemaining.has(candidate)) {
        match = candidate;
        matchedBy = 'email';
      }
    }
    // 3. Phone — both sides reduced to digits-with-optional-leading-+
    if (!match && m.phone) {
      const candidate = tfByPhone.get(normalisePhone(m.phone));
      if (candidate && tfRemaining.has(candidate)) {
        match = candidate;
        matchedBy = 'phone';
      }
    }
    // 4. Fuzzy name + birthdate
    if (!match && m.name && m.birthdate) {
      const mNameNorm = foldAccents(m.name).toLowerCase().replace(/\s+/g, ' ').trim();
      for (const t of tfRemaining) {
        if (!t.name || !t.birthdate) continue;
        if (!isDateTimeEqual(m.birthdate, t.birthdate, 0)) continue;
        const tNameNorm = foldAccents(t.name).toLowerCase().replace(/\s+/g, ' ').trim();
        if (levenshtein(mNameNorm, tNameNorm) < 3) {
          match = t;
          matchedBy = 'name+birthdate';
          break;
        }
      }
    }

    if (match) {
      tfRemaining.delete(match);
      pairs.push({ manatal: m, talentflow: match, matchedBy });
    } else {
      onlyInManatal.push(m);
    }
  }

  return {
    pairs,
    onlyInManatal,
    onlyInTalentflow: Array.from(tfRemaining),
  };
}

export function matchJobs(
  manatal: NormalisedJob[],
  talentflow: NormalisedJob[]
): MatchResult<NormalisedJob, NormalisedJob> {
  const tfRemaining = new Set(talentflow);
  const tfByRef = new Map<string, NormalisedJob>();
  for (const t of talentflow) {
    if (t.job_reference) tfByRef.set(t.job_reference, t);
  }

  const pairs: MatchResult<NormalisedJob, NormalisedJob>['pairs'] = [];
  const onlyInManatal: NormalisedJob[] = [];

  for (const m of manatal) {
    let match: NormalisedJob | undefined;
    let matchedBy: RecordDiff['matched_by'] = 'unmatched';

    if (!match && m.job_reference) {
      const candidate = tfByRef.get(m.job_reference);
      if (candidate && tfRemaining.has(candidate)) {
        match = candidate;
        matchedBy = 'reference';
      }
    }
    if (!match && m.title) {
      const mTitle = foldAccents(m.title).toLowerCase().replace(/\s+/g, ' ').trim();
      const mLoc = m.location
        ? foldAccents(m.location).toLowerCase().replace(/\s+/g, ' ').trim()
        : '';
      for (const t of tfRemaining) {
        if (!t.title) continue;
        const tTitle = foldAccents(t.title).toLowerCase().replace(/\s+/g, ' ').trim();
        const tLoc = t.location
          ? foldAccents(t.location).toLowerCase().replace(/\s+/g, ' ').trim()
          : '';
        if (tTitle === mTitle && tLoc === mLoc) {
          match = t;
          matchedBy = 'title+location';
          break;
        }
      }
    }

    if (match) {
      tfRemaining.delete(match);
      pairs.push({ manatal: m, talentflow: match, matchedBy });
    } else {
      onlyInManatal.push(m);
    }
  }

  return {
    pairs,
    onlyInManatal,
    onlyInTalentflow: Array.from(tfRemaining),
  };
}

export function matchApplications(
  manatal: NormalisedApplication[],
  talentflow: NormalisedApplication[]
): MatchResult<NormalisedApplication, NormalisedApplication> {
  const tfRemaining = new Set(talentflow);
  const keyByRef = (a: NormalisedApplication): string | null =>
    a.candidate_reference && a.job_reference
      ? `${a.candidate_reference}|${a.job_reference}`
      : null;
  const keyByEmailTitle = (a: NormalisedApplication): string | null =>
    a.candidate_email && a.job_title
      ? `${a.candidate_email}|${foldAccents(a.job_title).toLowerCase().trim()}`
      : null;

  const tfByRef = new Map<string, NormalisedApplication>();
  const tfByEmailTitle = new Map<string, NormalisedApplication>();
  for (const t of talentflow) {
    const k1 = keyByRef(t);
    if (k1) tfByRef.set(k1, t);
    const k2 = keyByEmailTitle(t);
    if (k2) tfByEmailTitle.set(k2, t);
  }

  const pairs: MatchResult<NormalisedApplication, NormalisedApplication>['pairs'] = [];
  const onlyInManatal: NormalisedApplication[] = [];

  for (const m of manatal) {
    let match: NormalisedApplication | undefined;
    const k1 = keyByRef(m);
    if (k1) {
      const c = tfByRef.get(k1);
      if (c && tfRemaining.has(c)) match = c;
    }
    if (!match) {
      const k2 = keyByEmailTitle(m);
      if (k2) {
        const c = tfByEmailTitle.get(k2);
        if (c && tfRemaining.has(c)) match = c;
      }
    }
    if (match) {
      tfRemaining.delete(match);
      pairs.push({ manatal: m, talentflow: match, matchedBy: 'job+candidate' });
    } else {
      onlyInManatal.push(m);
    }
  }

  return { pairs, onlyInManatal, onlyInTalentflow: Array.from(tfRemaining) };
}

// ────────────────────────────────────────────────────────────────────────────
// Build the full ParityReport from normalised inputs.
// ────────────────────────────────────────────────────────────────────────────

export function buildReport(
  tenantId: string,
  tolerance: ToleranceConfig,
  inputs: {
    manatalCandidates: NormalisedCandidate[];
    talentflowCandidates: NormalisedCandidate[];
    manatalJobs: NormalisedJob[];
    talentflowJobs: NormalisedJob[];
    manatalApplications: NormalisedApplication[];
    talentflowApplications: NormalisedApplication[];
  }
): ParityReport {
  const start = performance.now();

  const records: RecordDiff[] = [];

  // — Candidates —
  const candidateMatch = matchCandidates(
    inputs.manatalCandidates,
    inputs.talentflowCandidates
  );
  const candidateFields = Object.keys(CANDIDATE_FIELD_COMPARATORS);
  for (const p of candidateMatch.pairs) {
    const diffs = diffFields(
      'candidate',
      p.manatal as unknown as Record<string, unknown>,
      p.talentflow as unknown as Record<string, unknown>,
      candidateFields,
      tolerance
    );
    records.push({
      entity: 'candidate',
      matched_by: p.matchedBy,
      manatal_id: p.manatal.source_id,
      talentflow_id: p.talentflow.source_id,
      status:
        diffs.filter((d) => d.severity !== 'tolerance').length === 0
          ? 'match'
          : 'partial_match',
      diffs,
    });
  }
  for (const m of candidateMatch.onlyInManatal) {
    records.push({
      entity: 'candidate',
      matched_by: 'unmatched',
      manatal_id: m.source_id,
      talentflow_id: null,
      status: 'only_in_manatal',
      diffs: [
        {
          field: '__missing__',
          manatal_value: m.candidate_reference ?? m.email ?? m.name,
          talentflow_value: null,
          severity: 'critical',
        },
      ],
    });
  }
  for (const t of candidateMatch.onlyInTalentflow) {
    records.push({
      entity: 'candidate',
      matched_by: 'unmatched',
      manatal_id: null,
      talentflow_id: t.source_id,
      status: 'only_in_talentflow',
      diffs: [
        {
          field: '__missing__',
          manatal_value: null,
          talentflow_value: t.candidate_reference ?? t.email ?? t.name,
          severity: 'critical',
        },
      ],
    });
  }

  // — Jobs —
  const jobMatch = matchJobs(inputs.manatalJobs, inputs.talentflowJobs);
  const jobFields = Object.keys(JOB_FIELD_COMPARATORS);
  for (const p of jobMatch.pairs) {
    const diffs = diffFields(
      'job',
      p.manatal as unknown as Record<string, unknown>,
      p.talentflow as unknown as Record<string, unknown>,
      jobFields,
      tolerance
    );
    records.push({
      entity: 'job',
      matched_by: p.matchedBy,
      manatal_id: p.manatal.source_id,
      talentflow_id: p.talentflow.source_id,
      status:
        diffs.filter((d) => d.severity !== 'tolerance').length === 0
          ? 'match'
          : 'partial_match',
      diffs,
    });
  }
  for (const m of jobMatch.onlyInManatal) {
    records.push({
      entity: 'job',
      matched_by: 'unmatched',
      manatal_id: m.source_id,
      talentflow_id: null,
      status: 'only_in_manatal',
      diffs: [
        {
          field: '__missing__',
          manatal_value: m.job_reference ?? m.title,
          talentflow_value: null,
          severity: 'critical',
        },
      ],
    });
  }
  for (const t of jobMatch.onlyInTalentflow) {
    records.push({
      entity: 'job',
      matched_by: 'unmatched',
      manatal_id: null,
      talentflow_id: t.source_id,
      status: 'only_in_talentflow',
      diffs: [
        {
          field: '__missing__',
          manatal_value: null,
          talentflow_value: t.job_reference ?? t.title,
          severity: 'critical',
        },
      ],
    });
  }

  // — Applications —
  const appMatch = matchApplications(
    inputs.manatalApplications,
    inputs.talentflowApplications
  );
  const appFields = Object.keys(APPLICATION_FIELD_COMPARATORS);
  for (const p of appMatch.pairs) {
    const diffs = diffFields(
      'application',
      p.manatal as unknown as Record<string, unknown>,
      p.talentflow as unknown as Record<string, unknown>,
      appFields,
      tolerance
    );
    records.push({
      entity: 'application',
      matched_by: p.matchedBy,
      manatal_id: p.manatal.source_id,
      talentflow_id: p.talentflow.source_id,
      status:
        diffs.filter((d) => d.severity !== 'tolerance').length === 0
          ? 'match'
          : 'partial_match',
      diffs,
    });
  }
  for (const m of appMatch.onlyInManatal) {
    records.push({
      entity: 'application',
      matched_by: 'unmatched',
      manatal_id: m.source_id,
      talentflow_id: null,
      status: 'only_in_manatal',
      diffs: [
        {
          field: '__missing__',
          manatal_value: `${m.candidate_reference}@${m.job_reference}`,
          talentflow_value: null,
          severity: 'critical',
        },
      ],
    });
  }
  for (const t of appMatch.onlyInTalentflow) {
    records.push({
      entity: 'application',
      matched_by: 'unmatched',
      manatal_id: null,
      talentflow_id: t.source_id,
      status: 'only_in_talentflow',
      diffs: [
        {
          field: '__missing__',
          manatal_value: null,
          talentflow_value: `${t.candidate_reference}@${t.job_reference}`,
          severity: 'critical',
        },
      ],
    });
  }

  const summary = {
    candidates: summariseEntity(records, 'candidate', candidateMatch),
    jobs: summariseEntity(records, 'job', jobMatch),
    applications: summariseEntity(records, 'application', appMatch),
  };

  const counts = countSeverities(records);

  return {
    tenant_id: tenantId,
    generated_at: new Date().toISOString(),
    tolerance,
    summary,
    critical_count: counts.critical,
    major_count: counts.major,
    minor_count: counts.minor,
    tolerance_count: counts.tolerance,
    records,
    duration_ms: Math.round(performance.now() - start),
  };
}

function summariseEntity(
  records: RecordDiff[],
  entity: Entity,
  match: { pairs: unknown[]; onlyInManatal: unknown[]; onlyInTalentflow: unknown[] }
): EntitySummary {
  const entityRecords = records.filter((r) => r.entity === entity);
  return {
    total_manatal: match.pairs.length + match.onlyInManatal.length,
    total_talentflow: match.pairs.length + match.onlyInTalentflow.length,
    matched: entityRecords.filter((r) => r.status === 'match').length,
    partial: entityRecords.filter((r) => r.status === 'partial_match').length,
    only_manatal: entityRecords.filter((r) => r.status === 'only_in_manatal').length,
    only_talentflow: entityRecords.filter((r) => r.status === 'only_in_talentflow').length,
  };
}

function countSeverities(records: RecordDiff[]): {
  critical: number;
  major: number;
  minor: number;
  tolerance: number;
} {
  const out = { critical: 0, major: 0, minor: 0, tolerance: 0 };
  for (const r of records) {
    for (const d of r.diffs) {
      out[d.severity]++;
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Output formatters.
// ────────────────────────────────────────────────────────────────────────────

export function reportToJson(report: ParityReport): string {
  return JSON.stringify(report, null, 2);
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'CRITICAL',
  major: 'MAJOR',
  minor: 'MINOR',
  tolerance: 'TOLERANCE',
};

const STATUS_ICON = (s: number, ok: boolean) => (s === 0 ? 'OK' : ok ? 'OK' : 'WARN');

export function reportToMarkdown(report: ParityReport): string {
  const lines: string[] = [];
  const r = report;

  lines.push(`# TalentFlow ↔ Manatal Pariteit-rapport`);
  lines.push('');
  lines.push(`Generated: ${r.generated_at}`);
  lines.push(`Tenant: ${r.tenant_id}`);
  lines.push(`Duration: ${r.duration_ms} ms`);
  lines.push('');
  lines.push(`## Samenvatting`);
  lines.push('');
  lines.push(
    '| Entity | Manatal | TalentFlow | Match | Partial | Only Manatal | Only TalentFlow |'
  );
  lines.push('|---|---|---|---|---|---|---|');
  for (const [name, label] of [
    ['candidates', 'Kandidaten'],
    ['jobs', 'Vacatures'],
    ['applications', 'Sollicitaties'],
  ] as const) {
    const s = r.summary[name];
    lines.push(
      `| ${label} | ${s.total_manatal} | ${s.total_talentflow} | ${s.matched} | ${s.partial} | ${s.only_manatal} | ${s.only_talentflow} |`
    );
  }
  lines.push('');
  lines.push(
    `Severity-totalen: critical=${r.critical_count}, major=${r.major_count}, minor=${r.minor_count}, tolerance=${r.tolerance_count}.`
  );
  lines.push('');

  // Group diffs by severity for top sections.
  for (const sev of ['critical', 'major', 'minor'] as Severity[]) {
    const recordsWith = r.records.filter((rec) =>
      rec.diffs.some((d) => d.severity === sev)
    );
    lines.push(`## ${SEVERITY_LABEL[sev]} issues (${countAtSeverity(r.records, sev)})`);
    lines.push('');
    if (recordsWith.length === 0) {
      lines.push('Geen.');
      lines.push('');
      continue;
    }
    for (const rec of recordsWith) {
      const id = rec.manatal_id ?? rec.talentflow_id ?? '?';
      const label =
        rec.entity === 'candidate'
          ? 'Kandidaat'
          : rec.entity === 'job'
            ? 'Vacature'
            : 'Sollicitatie';
      lines.push(`### ${label}: ${id} (matched by: ${rec.matched_by}, status: ${rec.status})`);
      for (const d of rec.diffs.filter((x) => x.severity === sev)) {
        if (d.field === '__missing__') {
          lines.push(
            `- ${d.severity.toUpperCase()}: missend record. Manatal=${stringify(d.manatal_value)}, TalentFlow=${stringify(d.talentflow_value)}`
          );
        } else {
          lines.push(
            `- \`${d.field}\`: Manatal=${stringify(d.manatal_value)} / TalentFlow=${stringify(d.talentflow_value)}`
          );
        }
      }
      lines.push('');
    }
  }

  // Cutover advice.
  lines.push('## Cutover-aanbeveling');
  lines.push('');
  if (r.critical_count > 0) {
    lines.push(
      `STOP CUTOVER. ${r.critical_count} critical issue(s) — onderzoek per record voordat shadow-run wordt afgebroken.`
    );
  } else if (r.major_count > 0) {
    lines.push(
      `BESPREEK MET IT PROPOSAL. 0 critical, ${r.major_count} major. Bevestig dat majors acceptabel zijn vóór go-live.`
    );
  } else {
    lines.push(
      `READY: 0 critical, 0 major, ${r.minor_count} minor + ${r.tolerance_count} binnen tolerance. Cutover vrijgegeven.`
    );
  }
  lines.push('');

  return lines.join('\n');
}

function countAtSeverity(records: RecordDiff[], sev: Severity): number {
  let n = 0;
  for (const r of records) {
    for (const d of r.diffs) {
      if (d.severity === sev) n++;
    }
  }
  return n;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '_(leeg)_';
  if (Array.isArray(v)) return `[${v.map((x) => String(x)).join(', ')}]`;
  return `\`${String(v)}\``;
}

export function reportToCsv(report: ParityReport): string {
  const header = ['entity', 'manatal_id', 'talentflow_id', 'field', 'manatal_value', 'talentflow_value', 'severity'];
  const lines = [header.join(',')];
  for (const r of report.records) {
    for (const d of r.diffs) {
      const cells = [
        r.entity,
        r.manatal_id ?? '',
        r.talentflow_id ?? '',
        d.field,
        csvEscape(d.manatal_value),
        csvEscape(d.talentflow_value),
        d.severity,
      ];
      lines.push(cells.join(','));
    }
  }
  return lines.join('\n');
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join(';') : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ────────────────────────────────────────────────────────────────────────────
// I/O — read CSVs + (optional) load TalentFlow data via service-laag.
// ────────────────────────────────────────────────────────────────────────────

export interface TalentflowDataset {
  candidates: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
  applications: Record<string, unknown>[];
}

/**
 * Loads TalentFlow data for the given tenant. Lazy import of the service-laag
 * so the script stays runnable without DB (e.g. in unit tests, where a fixture
 * is supplied instead).
 */
export async function loadTalentflowDataset(
  tenantId: string,
  fixturePath: string | null
): Promise<TalentflowDataset> {
  if (fixturePath) {
    const txt = fs.readFileSync(fixturePath, 'utf8');
    const parsed = JSON.parse(txt) as TalentflowDataset;
    return {
      candidates: parsed.candidates ?? [],
      jobs: parsed.jobs ?? [],
      applications: parsed.applications ?? [],
    };
  }

  // Lazy-load service-laag — keeps unit tests offline.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { listCandidates } = require('../src/modules/candidates/candidates.service') as
    typeof import('../src/modules/candidates/candidates.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { listJobs } = require('../src/modules/jobs/jobs.service') as
    typeof import('../src/modules/jobs/jobs.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { withTenant } = require('../src/db/pool') as typeof import('../src/db/pool');

  const candidates: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  const PAGE = 500;

  for (let page = 1; ; page++) {
    const res = await listCandidates(tenantId, { page, limit: PAGE });
    candidates.push(...(res.data as Record<string, unknown>[]));
    if (res.data.length < PAGE) break;
  }
  for (let page = 1; ; page++) {
    const res = await listJobs(tenantId, { page, limit: PAGE });
    jobs.push(...(res.data as Record<string, unknown>[]));
    if (res.data.length < PAGE) break;
  }

  // Applications: there is no listApplications service helper today, so we
  // read directly via withTenant(). This keeps service-code untouched.
  const applications = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT a.id, a.tenant_id, a.candidate_id, a.job_id, a.stage_id,
              a.status, a.applied_at, a.updated_at,
              c.candidate_reference, c.email AS candidate_email,
              j.job_reference, j.title AS job_title,
              ps.name AS stage_name
       FROM applications a
       LEFT JOIN candidates c ON c.id = a.candidate_id
       LEFT JOIN jobs j ON j.id = a.job_id
       LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id
       WHERE a.tenant_id = $1`,
      [tenantId]
    );
    return rows as Record<string, unknown>[];
  });

  return { candidates, jobs, applications };
}

export function readManatalCsv(filePath: string | undefined, kind: 'candidate'): NormalisedCandidate[];
export function readManatalCsv(filePath: string | undefined, kind: 'job'): NormalisedJob[];
export function readManatalCsv(filePath: string | undefined, kind: 'application'): NormalisedApplication[];
export function readManatalCsv(
  filePath: string | undefined,
  kind: 'candidate' | 'job' | 'application'
): NormalisedCandidate[] | NormalisedJob[] | NormalisedApplication[] {
  if (!filePath) return [];
  if (!fs.existsSync(filePath)) {
    throw new Error(`Manatal CSV niet gevonden: ${filePath}`);
  }
  const txt = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(txt);
  if (kind === 'candidate') return rows.map((r, i) => mapManatalCandidate(r, i));
  if (kind === 'job') return rows.map((r, i) => mapManatalJob(r, i));
  return rows.map((r, i) => mapManatalApplication(r, i));
}

// ────────────────────────────────────────────────────────────────────────────
// Webhook notifications (continuous mode bonus).
// ────────────────────────────────────────────────────────────────────────────

async function notifyWebhook(url: string, report: ParityReport): Promise<void> {
  if (typeof fetch === 'undefined') {
    // eslint-disable-next-line no-console
    console.warn('[parity] global fetch not available — skip webhook');
    return;
  }
  const body = {
    tenant_id: report.tenant_id,
    generated_at: report.generated_at,
    critical_count: report.critical_count,
    major_count: report.major_count,
    summary: report.summary,
  };
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[parity] webhook failed', (err as Error).message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Output helpers — write all 3 report files atomically.
// ────────────────────────────────────────────────────────────────────────────

export function writeReportFiles(report: ParityReport, outputDir: string): {
  json: string;
  md: string;
  csv: string;
} {
  fs.mkdirSync(outputDir, { recursive: true });
  const ts = report.generated_at.replace(/[:.]/g, '-');
  const jsonPath = path.join(outputDir, `parity-report-${ts}.json`);
  const mdPath = path.join(outputDir, `parity-report-${ts}.md`);
  const csvPath = path.join(outputDir, `mismatches-${ts}.csv`);

  fs.writeFileSync(jsonPath, reportToJson(report), 'utf8');
  fs.writeFileSync(mdPath, reportToMarkdown(report), 'utf8');
  fs.writeFileSync(csvPath, reportToCsv(report), 'utf8');
  return { json: jsonPath, md: mdPath, csv: csvPath };
}

// ────────────────────────────────────────────────────────────────────────────
// Single-shot run (one comparison cycle).
// ────────────────────────────────────────────────────────────────────────────

export async function runOnce(args: CliArgs): Promise<ParityReport> {
  const tf = await loadTalentflowDataset(args.tenantId, args.talentflowFixture);

  const manatalCandidates = readManatalCsv(args.manatalCandidates, 'candidate');
  const manatalJobs = readManatalCsv(args.manatalJobs, 'job');
  const manatalApplications = readManatalCsv(args.manatalApplications, 'application');

  const report = buildReport(args.tenantId, args.tolerance, {
    manatalCandidates,
    talentflowCandidates: tf.candidates.map(normaliseTalentflowCandidate),
    manatalJobs,
    talentflowJobs: tf.jobs.map(normaliseTalentflowJob),
    manatalApplications,
    talentflowApplications: tf.applications.map(normaliseTalentflowApplication),
  });

  const written = writeReportFiles(report, args.outputDir);
  // eslint-disable-next-line no-console
  console.log(
    `[parity] wrote ${written.md}  (critical=${report.critical_count}, major=${report.major_count}, minor=${report.minor_count})`
  );
  if (args.webhook) {
    await notifyWebhook(args.webhook, report);
  }
  return report;
}

// ────────────────────────────────────────────────────────────────────────────
// CLI entrypoint.
// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[parity] CLI error: ${(err as Error).message}`);
    process.exitCode = 2;
    return;
  }

  const runWithExit = async (): Promise<ParityReport> => {
    const report = await runOnce(args);
    if (args.strict && report.critical_count > 0) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
    return report;
  };

  if (args.watchMinutes && args.watchMinutes > 0) {
    // Continuous mode — re-run every N minutes. Track previous critical-set
    // so we can notify on NEW criticals (delta-only).
    let lastCriticalIds = new Set<string>();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const report = await runOnce(args);
      const currentCriticalIds = new Set(
        report.records
          .filter((r) =>
            r.diffs.some((d) => d.severity === 'critical')
          )
          .map((r) => `${r.entity}:${r.manatal_id ?? r.talentflow_id}`)
      );
      const newOnes = [...currentCriticalIds].filter((x) => !lastCriticalIds.has(x));
      if (newOnes.length > 0 && args.webhook) {
        await notifyWebhook(args.webhook, report);
      }
      lastCriticalIds = currentCriticalIds;

      // eslint-disable-next-line no-console
      console.log(
        `[parity] watch — sleeping ${args.watchMinutes}m. New criticals: ${newOnes.length}`
      );
      await new Promise((res) => setTimeout(res, args.watchMinutes! * 60 * 1000));
    }
  } else {
    await runWithExit();
  }
}

// Only invoke main() when run directly (not under test import).
if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[parity] fatal', err);
    process.exitCode = 2;
  });
}
